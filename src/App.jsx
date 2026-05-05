import React, { useState, useEffect } from 'react';
import EditorModule from 'react-simple-code-editor';
const Editor = EditorModule.default || EditorModule;
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';
import './App.css';

const DEFAULT_PYTHON_CODE = `def fib(n):
    if n <= 1:
        return n
    left = fib(n - 1)
    right = fib(n - 2)
    return left + right

# The last line should call the function
fib(4)`;

const PYTHON_TRACER_SCRIPT = `
import sys
import json

class Tracer:
    def __init__(self):
        self.steps = []
        self.tree_nodes = {}
        self.node_id_counter = 0
        self.stack = []
        
    def trace_calls(self, frame, event, arg):
        if frame.f_code.co_filename != "<string>":
            return self.trace_calls
            
        func_name = frame.f_code.co_name
        if func_name == "<module>":
            return self.trace_calls

        if event == 'call':
            node_id = self.node_id_counter
            self.node_id_counter += 1
            
            args_str = ','.join(str(frame.f_locals.get(var)) for var in frame.f_code.co_varnames[:frame.f_code.co_argcount])
            label = f"{func_name}({args_str})"
            
            node = { "id": node_id, "label": label, "children": [], "value": None }
            self.tree_nodes[node_id] = node
            
            parent_id = self.stack[-1][0] if self.stack else None
            if parent_id is not None:
                self.tree_nodes[parent_id]["children"].append(node)
                
            self.steps.append({
                "type": "CALL", 
                "nodeId": node_id, 
                "label": f"Calling {label}", 
                "parentId": parent_id
            })
            
            self.stack.append((node_id, label))
            
        elif event == 'return':
            if self.stack:
                node_id, label = self.stack.pop()
                self.tree_nodes[node_id]["value"] = arg
                self.steps.append({
                    "type": "RETURN", 
                    "nodeId": node_id, 
                    "label": f"{label} returned {arg}", 
                    "value": arg
                })
        return self.trace_calls

tracer = Tracer()
sys.settrace(tracer.trace_calls)

try:
    exec(user_code, globals())
finally:
    sys.settrace(None)

root_nodes = [n for n_id, n in tracer.tree_nodes.items() if not any(n in parent['children'] for parent in tracer.tree_nodes.values())]
root_tree = root_nodes[0] if root_nodes else None

json.dumps({ "steps": tracer.steps, "tree": root_tree })
`;

function TreeNode({ node, activeNodeId, returnedNodes }) {
  if (!node) return null;
  const isActive = node.id === activeNodeId;
  const isReturned = returnedNodes.has(node.id);
  
  return (
    <li>
      <div className={`tree-node ${isActive ? 'active' : ''} ${isReturned ? 'returned' : ''}`}>
        <div className="node-label">{node.label}</div>
        {isReturned && <div className="node-value">Result: {String(node.value)}</div>}
      </div>
      {node.children && node.children.length > 0 && (
        <ul>
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} activeNodeId={activeNodeId} returnedNodes={returnedNodes} />
          ))}
        </ul>
      )}
    </li>
  );
}

function App() {
  const [code, setCode] = useState(DEFAULT_PYTHON_CODE);
  const [pyodide, setPyodide] = useState(null);
  const [treeData, setTreeData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorError, setError] = useState(null);

  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000);

  useEffect(() => {
    async function loadPyodide() {
      try {
        const loadedPyodide = await window.loadPyodide();
        setPyodide(loadedPyodide);
        setIsLoading(false);
      } catch (err) {
        console.error(err);
        setError('Failed to load Pyodide. Ensure internet connection.');
        setIsLoading(false);
      }
    }
    loadPyodide();
  }, []);

  const runCode = async () => {
    if (!pyodide) return;
    setError(null);
    setTreeData(null);
    setCurrentStepIndex(-1);
    setIsPlaying(false);

    try {
      pyodide.globals.set('user_code', code);
      const resultJson = await pyodide.runPythonAsync(PYTHON_TRACER_SCRIPT);
      const result = JSON.parse(resultJson);
      
      if (result.tree) {
        setTreeData(result);
      } else {
        setError('No recursion detected. Did you call the function?');
      }
    } catch (err) {
      console.error(err);
      setError(err.message ? err.message.toString() : String(err));
    }
  };

  const steps = treeData?.steps || [];
  
  useEffect(() => {
    let timer;
    if (isPlaying && currentStepIndex < steps.length - 1) {
      timer = setTimeout(() => {
        setCurrentStepIndex(prev => prev + 1);
      }, speed);
    } else if (currentStepIndex >= steps.length - 1) {
      setIsPlaying(false);
    }
    return () => clearTimeout(timer);
  }, [isPlaying, currentStepIndex, speed, steps.length]);

  const activeStep = currentStepIndex >= 0 ? steps[currentStepIndex] : null;
  const activeNodeId = activeStep ? activeStep.nodeId : null;
  
  const returnedNodes = new Set();
  for (let i = 0; i <= currentStepIndex; i++) {
    if (steps[i]?.type === 'RETURN') {
      returnedNodes.add(steps[i].nodeId);
    }
  }

  return (
    <div className="app-container">
      <div className="sidebar">
        <div style={{ padding: '10px', background: '#333', color: 'white' }}>
          <h3>Python Visualizer (Pyodide)</h3>
          {isLoading && <p>Loading Python engine...</p>}
        </div>
        
        <div className="editor-container" style={{ background: '#2d2d2d' }}>
          <Editor
            value={code}
            onValueChange={setCode}
            highlight={c => Prism.highlight(c, Prism.languages.python, 'python')}
            padding={15}
            style={{
              fontFamily: 'monospace',
              fontSize: 14,
              outline: 'none',
              minHeight: '100%'
            }}
          />
        </div>
        
        <div style={{ padding: '10px', background: '#fff' }}>
          <button className="primary" onClick={runCode} disabled={isLoading}>Generate Recursion Tree</button>
          {errorError && <div style={{ color: 'red', marginTop: '10px', whiteSpace: 'pre-wrap', fontSize: '12px' }}>{errorError}</div>}
        </div>
      </div>

      <div className="main-content">
        <header className="controls">
          <div className="control-panel">
            <button onClick={() => setCurrentStepIndex(c => Math.max(-1, c - 1))} disabled={currentStepIndex <= -1 || isPlaying || !treeData}>Prev</button>
            <button onClick={() => setIsPlaying(!isPlaying)} disabled={!treeData}>
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button onClick={() => setCurrentStepIndex(c => Math.min(steps.length - 1, c + 1))} disabled={currentStepIndex >= steps.length - 1 || isPlaying || !treeData}>Next</button>
            <button onClick={() => { setIsPlaying(false); setCurrentStepIndex(-1); }} disabled={!treeData}>Reset</button>

            <label style={{marginLeft: '10px'}}>
              Speed: 
              <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
                <option value={2000}>Slow</option>
                <option value={1000}>Normal</option>
                <option value={200}>Fast</option>
              </select>
            </label>
          </div>

          <div className="step-info">
            <h3>Activity: <span style={{color: '#007bff'}}>{activeStep ? activeStep.label : 'Waiting to start...'}</span></h3>
            <p>Step {Math.max(0, currentStepIndex + 1)} of {steps.length}</p>
          </div>
        </header>

        <main className="tree-view">
          {treeData ? (
            <div className="tree-container">
              <ul className="tree">
                <TreeNode node={treeData.tree} activeNodeId={activeNodeId} returnedNodes={returnedNodes} />
              </ul>
            </div>
          ) : (
            <div style={{color: '#888'}}>Run the code to see the recursion tree here.</div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;