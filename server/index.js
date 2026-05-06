const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5001;

app.use(cors());
app.use(bodyParser.json());

// ── Java Tracer Template ─────────────────────────────────────────────
// Using \\\" to escape quotes for the generated Java source
const TRACER_JAVA_SOURCE = `
import java.util.*;

public class Tracer {
    static {
        // Automatically print results when the program finishes
        Runtime.getRuntime().addShutdownHook(new Thread(() -> Tracer.printResults()));
    }

    private static List<Map<String, Object>> steps = new ArrayList<>();
    private static Map<Integer, Node> nodes = new HashMap<>();
    private static Stack<Integer> stack = new Stack<>();
    private static int idCounter = 0;

    public static class Node {
        int id;
        String funcName;
        Map<String, Object> args;
        Object value;
        List<Node> children = new ArrayList<>();
        Node(int id, String funcName, Map<String, Object> args) { this.id = id; this.funcName = funcName; this.args = args; }
    }

    public static int enter(String name, String[] argNames, Object[] argValues) {
        int id = idCounter++;
        Integer parentId = stack.isEmpty() ? null : stack.peek();
        
        Map<String, Object> argsMap = new LinkedHashMap<>();
        for(int i=0; i<argNames.length; i++) {
            argsMap.put(argNames[i], argValues[i] == null ? "null" : argValues[i].toString());
        }
        
        Map<String, Object> step = new HashMap<>();
        step.put("type", "CALL");
        step.put("nodeId", id);
        step.put("funcName", name);
        step.put("args", argsMap);
        step.put("parentId", parentId);
        steps.add(step);

        Node node = new Node(id, name, argsMap);
        nodes.put(id, node);
        if(parentId != null) nodes.get(parentId).children.add(node);
        
        stack.push(id);
        return id;
    }

    public static <T> T exit(int id, T value) {
        if (!stack.isEmpty() && stack.peek() == id) stack.pop();
        Node node = nodes.get(id);
        if (node != null) node.value = value;

        Map<String, Object> step = new HashMap<>();
        step.put("type", "RETURN");
        step.put("nodeId", id);
        step.put("label", (node != null ? node.funcName : "func") + " returned " + value);
        step.put("value", value);
        steps.add(step);

        return value;
    }

    public static void printResults() {
        if (nodes.isEmpty()) return;
        
        List<Node> roots = new ArrayList<>();
        Set<Integer> childIds = new HashSet<>();
        for(Node n : nodes.values()) {
            for(Node c : n.children) childIds.add(c.id);
        }
        for(Node n : nodes.values()) {
            if(!childIds.contains(n.id)) roots.add(n);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("steps", steps);
        result.put("tree", roots.isEmpty() ? null : roots.get(0));

        System.out.println("---JSON_START---");
        System.out.println(mapToJson(result));
        System.out.println("---JSON_END---");
    }

    private static String mapToJson(Object obj) {
        if (obj == null) return "null";
        if (obj instanceof String) return "\\\"" + obj + "\\\"";
        if (obj instanceof Number || obj instanceof Boolean) return obj.toString();
        if (obj instanceof List) {
            List<?> list = (List<?>) obj;
            StringBuilder sb = new StringBuilder("[");
            for(int i=0; i<list.size(); i++) {
                sb.append(mapToJson(list.get(i)));
                if(i < list.size()-1) sb.append(",");
            }
            return sb.append("]").toString();
        }
        if (obj instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) obj;
            StringBuilder sb = new StringBuilder("{");
            int i = 0;
            for(Map.Entry<?, ?> entry : map.entrySet()) {
                sb.append("\\\"").append(entry.getKey()).append("\\\":").append(mapToJson(entry.getValue()));
                if(i++ < map.size()-1) sb.append(",");
            }
            return sb.append("}").toString();
        }
        if (obj instanceof Node) {
            Node n = (Node) obj;
            return "{\\\"id\\\":" + n.id + ",\\\"funcName\\\":\\\"" + n.funcName + "\\\",\\\"args\\\":" + mapToJson(n.args) + ",\\\"value\\\":" + mapToJson(n.value) + ",\\\"children\\\":" + mapToJson(n.children) + "}";
        }
        return "\\\"" + obj.toString() + "\\\"";
    }
}
`;

function splitParameters(paramsStr) {
    const params = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < paramsStr.length; i++) {
        const char = paramsStr[i];
        if (char === '<') depth++;
        else if (char === '>') depth--;
        else if (char === ',' && depth === 0) {
            params.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }
    if (current.trim()) params.push(current.trim());
    return params;
}

function instrumentJava(source) {
    const lines = source.split('\n');
    const resultLines = [];
    let currentMethodIdVar = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Match method entry: static Type name(params) {
        const methodMatch = trimmed.match(/^((?:public|static|private|protected|\s)+)\s+([\w<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/);
        
        if (methodMatch && methodMatch[3] !== 'main' && !trimmed.includes('class')) {
            const name = methodMatch[3];
            const rawParams = methodMatch[4].trim();
            
            // Smart split for parameters to handle generics like HashMap<String, Integer>
            const paramDecls = splitParameters(rawParams);
            const params = paramDecls.filter(p => !p.trim().startsWith('//')).map(p => p.split(/\s+/).pop().replace(/\[\]/g, ''));
            const argNamesStr = params.length > 0 ? `new String[]{${params.map(p => `"${p}"`).join(', ')}}` : `new String[]{}`;
            const argValuesStr = params.length > 0 ? `new Object[]{${params.join(', ')}}` : `new Object[]{}`;
            
            resultLines.push(line);
            if (!trimmed.endsWith('{')) {
                if (lines[i+1]?.trim() === '{') { resultLines.push(lines[i+1]); i++; }
                else resultLines.push('{');
            }
            
            currentMethodIdVar = `_tid_${Math.floor(Math.random()*10000)}`;
            resultLines.push(`        int ${currentMethodIdVar} = Tracer.enter("${name}", ${argNamesStr}, ${argValuesStr});`);
            continue;
        }

        // Match return statements
        const retMatch = line.match(/^(\s*)return\s+(.*);/);
        if (retMatch && currentMethodIdVar) {
            const indent = retMatch[1];
            const expr = retMatch[2];
            resultLines.push(`${indent}return Tracer.exit(${currentMethodIdVar}, ${expr});`);
            continue;
        }

        resultLines.push(line);
    }

    return resultLines.join('\n');
}

app.post('/trace-java', async (req, res) => {
    const { code } = req.body;
    const tempDir = path.join(__dirname, 'temp_' + Date.now());
    fs.mkdirSync(tempDir);

    try {
        const classMatch = code.match(/class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : 'Main';
        const instrumentedCode = instrumentJava(code);

        fs.writeFileSync(path.join(tempDir, 'Tracer.java'), TRACER_JAVA_SOURCE);
        fs.writeFileSync(path.join(tempDir, className + '.java'), instrumentedCode);

        const javac = spawn('javac', [path.join(tempDir, 'Tracer.java'), path.join(tempDir, className + '.java')]);
        let compileErr = '';
        javac.stderr.on('data', d => compileErr += d);

        javac.on('close', c => {
            if (c !== 0) return res.status(400).json({ error: 'Compile error: ' + compileErr });

            const java = spawn('java', ['-cp', tempDir, className]);
            let output = '', runErr = '';
            java.stdout.on('data', d => output += d);
            java.stderr.on('data', d => runErr += d);

            java.on('close', () => {
                fs.rmSync(tempDir, { recursive: true, force: true });
                const startTag = '---JSON_START---', endTag = '---JSON_END---';
                const startIdx = output.indexOf(startTag), endIdx = output.indexOf(endTag);
                if (startIdx === -1) return res.status(500).json({ error: 'No trace output. Check if main() calls the function.' });
                res.json(JSON.parse(output.substring(startIdx + startTag.length, endIdx)));
            });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
        if(fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
