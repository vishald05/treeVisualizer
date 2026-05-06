import React, { useState, useEffect } from 'react';
import EditorModule from 'react-simple-code-editor';
const Editor = EditorModule.default || EditorModule;
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/themes/prism-tomorrow.css';
import './App.css';
import { javaToPython } from './javaTranspiler';
import * as htmlToImage from 'html-to-image';
import GIF from 'gif.js';

// ── Language Configurations ──────────────────────────────────────────

const LANGUAGES = [
  { id: 'python', label: 'Python', prismGrammar: 'python' },
  { id: 'java', label: 'Java', prismGrammar: 'java' },
];

const DEFAULT_SNIPPETS = {
  python: `def fib(n):
    if n <= 1:
        return n
    left = fib(n - 1)
    right = fib(n - 2)
    return left + right

# The last line should call the function
fib(4)`,

  java: `public class Main {
    static int fib(int n) {
        if (n <= 1) return n;
        int left = fib(n - 1);
        int right = fib(n - 2);
        return left + right;
    }

    public static void main(String[] args) {
        fib(4);
    }
}`,
};

// ── Python Tracer (unchanged) ────────────────────────────────────────

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
            
            arg_names = frame.f_code.co_varnames[:frame.f_code.co_argcount]
            args_dict = { var: str(frame.f_locals.get(var)) for var in arg_names }
            
            node = { "id": node_id, "funcName": func_name, "args": args_dict, "children": [], "value": None }
            self.tree_nodes[node_id] = node
            
            parent_id = self.stack[-1][0] if self.stack else None
            if parent_id is not None:
                self.tree_nodes[parent_id]["children"].append(node)
                
            self.steps.append({
                "type": "CALL", 
                "nodeId": node_id, 
                "funcName": func_name,
                "args": args_dict,
                "parentId": parent_id
            })
            
            self.stack.append((node_id, func_name))
            
        elif event == 'return':
            if self.stack:
                node_id, func_name = self.stack.pop()
                self.tree_nodes[node_id]["value"] = arg
                self.steps.append({
                    "type": "RETURN", 
                    "nodeId": node_id, 
                    "label": f"{func_name} returned {arg}", 
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

// ── Tree Node Component ──────────────────────────────────────────────

function TreeNode({ node, activeNodeId, returnedNodes, selectedArgs, nodeShape }) {
  if (!node) return null;
  const isActive = node.id === activeNodeId;
  const isReturned = returnedNodes.has(node.id);
  
  // Format the label dynamically based on selected args
  let argsArray = [];
  if (node.args) {
    for (const [k, v] of Object.entries(node.args)) {
      if (!selectedArgs || selectedArgs.has(k)) {
        argsArray.push(v);
      }
    }
  }
  const label = `${node.funcName}(${argsArray.join(',')})`;
  
  return (
    <li>
      <div className={`tree-node shape-${nodeShape} ${isActive ? 'active' : ''} ${isReturned ? 'returned' : ''}`}>
        <div className="node-label">{label}</div>
        {isReturned && <div className="node-value">Result: {String(node.value)}</div>}
      </div>
      {node.children && node.children.length > 0 && (
        <ul>
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} activeNodeId={activeNodeId} returnedNodes={returnedNodes} selectedArgs={selectedArgs} nodeShape={nodeShape} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── App Component ────────────────────────────────────────────────────

function App() {
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState(DEFAULT_SNIPPETS.python);
  const [pyodide, setPyodide] = useState(null);
  const [treeData, setTreeData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [translatedCode, setTranslatedCode] = useState(null);
  const [showTranslated, setShowTranslated] = useState(false);

  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000);
  const [executionMode, setExecutionMode] = useState('local'); // 'local' (transpile) or 'remote' (backend)
  const [availableArgs, setAvailableArgs] = useState([]);
  const [selectedArgs, setSelectedArgs] = useState(new Set());
  const [isCodeEditorVisible, setIsCodeEditorVisible] = useState(true);
  const [scale, setScale] = useState(1);
  const [darkMode, setDarkMode] = useState(true);
  const [nodeShape, setNodeShape] = useState('rectangle');
  const [isRecording, setIsRecording] = useState(false);

  // Load Pyodide on mount
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

  // Switch language → load default snippet
  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    setCode(DEFAULT_SNIPPETS[newLang]);
    setTreeData(null);
    setCurrentStepIndex(-1);
    setIsPlaying(false);
    setError(null);
    setTranslatedCode(null);
    setShowTranslated(false);
    if (newLang === 'python') setExecutionMode('local');
  };

  // Get the correct Prism grammar for the current language
  const currentLangConfig = LANGUAGES.find(l => l.id === language);
  const prismGrammar = Prism.languages[currentLangConfig?.prismGrammar || 'python'];
  const prismLangName = currentLangConfig?.prismGrammar || 'python';

  // ── Run Code ─────────────────────────────────────────────────────

  const processResult = (result) => {
    if (result.tree) {
      setTreeData(result);
      const allArgs = new Set();
      const traverse = (n) => {
        if (n.args) Object.keys(n.args).forEach(k => allArgs.add(k));
        n.children?.forEach(traverse);
      };
      traverse(result.tree);
      const argNames = Array.from(allArgs);
      setAvailableArgs(argNames);
      setSelectedArgs(new Set(argNames));
    } else {
      setError('No recursion detected. Did you call the function in main()?');
    }
  };

  const downloadGIF = async () => {
    if (!treeData || !treeData.steps || treeData.steps.length === 0) return;
    
    setIsRecording(true);
    setIsPlaying(false);
    
    const originalStep = currentStepIndex;
    const treeElement = document.querySelector('.tree-view');
    
    const gif = new GIF({
      workers: 2,
      quality: 10,
      workerScript: '/gif.worker.js',
      width: treeElement.scrollWidth,
      height: treeElement.scrollHeight,
      background: darkMode ? '#121212' : '#ffffff'
    });

    // Reset zoom temporarily
    const originalScale = scale;
    setScale(1);

    for (let i = 0; i < treeData.steps.length; i++) {
      setCurrentStepIndex(i);
      
      // Wait for React render + CSS animation to settle
      await new Promise(r => setTimeout(r, 200)); 
      
      const canvas = await htmlToImage.toCanvas(treeElement, {
        backgroundColor: darkMode ? '#121212' : '#ffffff',
        width: treeElement.scrollWidth,
        height: treeElement.scrollHeight,
      });
      
      gif.addFrame(canvas, { delay: speed });
    }
    
    gif.on('finished', function(blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'recursion-tree.gif';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setIsRecording(false);
      setCurrentStepIndex(originalStep);
      setScale(originalScale);
    });
    
    gif.render();
  };

  const runCode = async () => {
    if (!pyodide && executionMode === 'local') return;
    setError(null);
    setTreeData(null);
    setCurrentStepIndex(-1);
    setIsPlaying(false);

    // Mode: Remote (Real Java Backend)
    if (language === 'java' && executionMode === 'remote') {
      try {
        setIsLoading(true);
        const response = await fetch('http://localhost:5001/trace-java', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const result = await response.json();
        setIsLoading(false);
        
        if (result.error) {
          setError(result.error);
        } else {
          processResult(result);
        }
        return;
      } catch (err) {
        setIsLoading(false);
        setError(`Backend error: ${err.message}. Make sure the server is running (npm run server)`);
        return;
      }
    }

    // Mode: Local (Transpilation-based)
    let pythonCode = code;

    // If Java, transpile to Python locally if not already done or if edited
    if (language === 'java') {
      try {
        // Use edited code if available, otherwise transpile
        if (!translatedCode) {
          pythonCode = javaToPython(code);
          setTranslatedCode(pythonCode);
          setShowTranslated(true);
        } else {
          pythonCode = translatedCode;
        }
      } catch (err) {
        console.error(err);
        setError(`Transpilation failed: ${err.message || String(err)}`);
        return;
      }
    }

    // Run the Python code through Pyodide tracer
    try {
      pyodide.globals.set('user_code', pythonCode);
      const resultJson = await pyodide.runPythonAsync(PYTHON_TRACER_SCRIPT);
      const result = JSON.parse(resultJson);
      processResult(result);
    } catch (err) {
      console.error(err);
      setError(err.message ? err.message.toString() : String(err));
    }
  };

  // ── Playback ──────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className={`app-container ${isCodeEditorVisible ? '' : 'sidebar-hidden'} ${darkMode ? 'dark-mode' : ''}`}>
      <div className={`sidebar ${isCodeEditorVisible ? 'visible' : 'hidden'}`}>
        <div className="sidebar-header">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <h3>Recursion Tree Visualizer</h3>
            <button className="theme-toggle" onClick={() => setDarkMode(!darkMode)} title="Toggle Dark Mode">
              {darkMode ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>
          
          {isLoading && <p className="loading-text">Loading Python engine...</p>}
          
          <div className="language-selector">
            <label htmlFor="lang-select">Language:</label>
            <select
              id="lang-select"
              value={language}
              onChange={e => handleLanguageChange(e.target.value)}
            >
              {LANGUAGES.map(lang => (
                <option key={lang.id} value={lang.id}>{lang.label}</option>
              ))}
            </select>
            {language === 'java' && (
              <div className="engine-selector">
                <label>Engine:</label>
                <div className="segmented-control">
                  <button 
                    className={executionMode === 'local' ? 'active' : ''} 
                    onClick={() => setExecutionMode('local')}
                    title="Transpiles Java to Python locally in the browser"
                  >
                    Local (WASM)
                  </button>
                  <button 
                    className={executionMode === 'remote' ? 'active' : ''} 
                    onClick={() => setExecutionMode('remote')}
                    title="Runs real Java on the server (requires JDK)"
                  >
                    Remote (JDK)
                  </button>
                </div>
              </div>
            )}

            {language === 'java' && executionMode === 'local' && (
              <span className="transpile-badge" title="Java code will be transpiled to Python locally">
                ⚡ Local Transpile
              </span>
            )}
            {language === 'java' && executionMode === 'remote' && (
              <span className="remote-badge" title="Using real Java backend">
                🌍 Backend Engine
              </span>
            )}
          </div>
        </div>
        
        <div className="editor-container" style={{ background: '#2d2d2d' }}>
          <Editor
            value={code}
            onValueChange={setCode}
            highlight={c => Prism.highlight(c, prismGrammar, prismLangName)}
            padding={15}
            style={{
              fontFamily: 'monospace',
              fontSize: 14,
              outline: 'none',
              minHeight: '100%'
            }}
          />
        </div>

        {/* Translated Python preview (for Java) */}
        {language === 'java' && (
          <div className="translated-panel">
            <div className="translated-header">
              <button
                className="translated-toggle"
                onClick={() => setShowTranslated(!showTranslated)}
              >
                {showTranslated ? '▾' : '▸'} Transpiled Python (Editable)
              </button>
              <button 
                className="retranspile-btn"
                onClick={() => {
                  try {
                    const py = javaToPython(code);
                    setTranslatedCode(py);
                    setShowTranslated(true);
                  } catch (err) {
                    setError(`Transpilation failed: ${err.message}`);
                  }
                }}
              >
                🔄 Re-transpile
              </button>
            </div>
            {showTranslated && (
              <div className="translated-editor-wrapper">
                <Editor
                  value={translatedCode || ''}
                  onValueChange={setTranslatedCode}
                  highlight={c => Prism.highlight(c, Prism.languages.python, 'python')}
                  padding={10}
                  className="translated-editor"
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 12,
                    outline: 'none',
                    background: '#1a1a2e',
                    color: '#c4e0c4',
                    minHeight: '100px',
                    maxHeight: '300px',
                    overflow: 'auto'
                  }}
                />
              </div>
            )}
          </div>
        )}
        
        <div className="sidebar-footer">
          <button className="primary" onClick={runCode} disabled={isLoading}>
            Generate Recursion Tree
          </button>
          {error && <div className="error-message">{error}</div>}
        </div>
      </div>

      <div className="main-content">
        <header className="controls">
          <div className="control-panel">
            <button onClick={() => setIsCodeEditorVisible(!isCodeEditorVisible)} title="Toggle Sidebar">
              {isCodeEditorVisible ? '⬅ Panel' : '☰ Code'}
            </button>
            <div className="divider"></div>
            <button onClick={() => setCurrentStepIndex(c => Math.max(-1, c - 1))} disabled={currentStepIndex <= -1 || isPlaying || !treeData}>Prev</button>
            <button onClick={() => setIsPlaying(!isPlaying)} disabled={!treeData}>
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button onClick={() => setCurrentStepIndex(c => Math.min(steps.length - 1, c + 1))} disabled={currentStepIndex >= steps.length - 1 || isPlaying || !treeData}>Next</button>
            <button onClick={() => { setIsPlaying(false); setCurrentStepIndex(-1); }} disabled={!treeData}>Reset</button>
            <button onClick={downloadGIF} disabled={!treeData || isRecording} style={{ marginLeft: '10px', background: isRecording ? '#dc3545' : '#28a745', color: 'white', border: 'none' }} title="Download animation as GIF">
              {isRecording ? '📸 Recording...' : '💾 GIF'}
            </button>

            <label style={{marginLeft: '10px'}}>
              Speed: 
              <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
                <option value={2000}>Slow</option>
                <option value={1000}>Normal</option>
                <option value={200}>Fast</option>
              </select>
            </label>

            <label style={{marginLeft: '10px'}}>
              Shape: 
              <select value={nodeShape} onChange={e => setNodeShape(e.target.value)}>
                <option value="rectangle">Rectangle</option>
                <option value="circle">Circle</option>
              </select>
            </label>
          </div>

          <div className="step-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3>Activity: <span style={{color: '#007bff'}}>{activeStep ? activeStep.label : 'Waiting to start...'}</span></h3>
              <p>Step {Math.max(0, currentStepIndex + 1)} of {steps.length}</p>
            </div>
            
            {availableArgs.length > 0 && (
              <div className="args-selector">
                <span style={{ fontSize: '13px', fontWeight: 'bold', marginRight: '8px' }}>Args:</span>
                {availableArgs.map(argName => (
                  <label key={argName} style={{ marginRight: '10px', fontSize: '13px', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={selectedArgs.has(argName)} 
                      onChange={(e) => {
                        const newSet = new Set(selectedArgs);
                        if (e.target.checked) newSet.add(argName);
                        else newSet.delete(argName);
                        setSelectedArgs(newSet);
                      }} 
                    />
                    {argName}
                  </label>
                ))}
              </div>
            )}
          </div>
        </header>

        <main className="tree-view" onWheel={(e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            setScale(s => Math.min(Math.max(0.1, s - e.deltaY * 0.005), 3));
          }
        }}>
          <div className="zoom-controls">
            <button onClick={() => setScale(s => Math.min(3, s + 0.1))}>Zoom In</button>
            <button onClick={() => setScale(s => Math.max(0.1, s - 0.1))}>Zoom Out</button>
            <button onClick={() => setScale(1)}>Reset Zoom</button>
            <span style={{fontSize: '12px', marginLeft: '5px'}}>{Math.round(scale * 100)}%</span>
          </div>
          {treeData ? (
            <div className="tree-container" style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>
              <ul className="tree">
                <TreeNode node={treeData.tree} activeNodeId={activeNodeId} returnedNodes={returnedNodes} selectedArgs={selectedArgs} nodeShape={nodeShape} />
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