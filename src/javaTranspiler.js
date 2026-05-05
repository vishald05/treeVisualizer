/**
 * Java-to-Python Transpiler
 * 
 * Handles the subset of Java commonly used in recursive functions:
 * - Method signatures (static return-type name(type arg, ...))
 * - if / else if / else (with and without braces)
 * - Variable declarations with type stripping
 * - return statements
 * - Operators: &&, ||, !, ==, !=
 * - Literals: true/false/null
 * - Common methods: Math.max, Math.min, Math.abs, System.out.println
 * - Array basics: new int[n], arr.length
 */

/**
 * Transpile Java code to Python.
 * @param {string} javaCode - The Java source code.
 * @returns {string} Equivalent Python code.
 */
export function javaToPython(javaCode) {
  let code = javaCode.trim();

  // ── Step 1: Remove package / import statements ───────────────────
  code = code.replace(/^package\s+[\w.]+;\s*/gm, '');
  code = code.replace(/^import\s+[\w.*]+;\s*/gm, '');

  // ── Step 2: Remove class wrapper ─────────────────────────────────
  code = removeClassWrapper(code);

  // ── Step 3: Extract the function call from main() ────────────────
  const mainCall = extractMainCall(code);
  code = removeMainMethod(code);

  // ── Step 4: Convert methods to Python functions ──────────────────
  // First pass: collect member variables
  const memberVars = collectMemberVars(code);
  const pythonBody = convertBody(code, memberVars);

  // ── Step 5: Append the entry-point call ──────────────────────────
  let result = (pythonBody.trim() + '\n\n' + mainCall.trim()).trim();

  // Prepend member variable initializations at the top level
  if (memberVars.length > 0) {
    const inits = memberVars.map(v => `${v.name} = ${v.value}`).join('\n');
    result = inits + '\n\n' + result;
  }

  return result;
}

/** Collect variables defined outside methods. */
function collectMemberVars(code) {
  const lines = code.split('\n');
  const vars = [];
  let inMethod = 0;

  for (let line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    const openBraces = (cleanLine.match(/\{/g) || []).length;
    const closeBraces = (cleanLine.match(/\}/g) || []).length;

    // A variable is a member if it's at level 0 (outside any method)
    if (inMethod === 0) {
       // Match: [static] [final] Type name [= value];
       const varDecl = cleanLine.match(/^(?:static\s+)?(?:final\s+)?(?:int|long|double|float|boolean|String|char|short|byte|var|Object|Long|Integer|Double|Float|Boolean|Character|\w+(?:<[^>]+>)?(?:\[\])*)\s+(\w+)\s*(?:=\s*(.+))?;?$/);
       if (varDecl && !cleanLine.includes('(')) {
         vars.push({
           name: varDecl[1],
           value: varDecl[2] ? convertExpression(varDecl[2]) : 'None'
         });
       }
    }

    inMethod += openBraces;
    inMethod -= closeBraces;
  }
  return vars;
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/** Strip the outer `class Foo { ... }` wrapper. */
function removeClassWrapper(code) {
  // Match: (public)? class Name (extends/implements ...)? {
  const classPattern = /^(public\s+)?class\s+\w+(\s+(extends|implements)\s+\w+)?\s*\{/m;
  const match = code.match(classPattern);
  if (!match) return code;

  // Remove the class line
  code = code.replace(classPattern, '');

  // Remove the matching closing brace (last '}' in the code)
  const lastBrace = code.lastIndexOf('}');
  if (lastBrace !== -1) {
    code = code.substring(0, lastBrace) + code.substring(lastBrace + 1);
  }

  return code;
}

/** Extract the function call(s) from `public static void main(...)`. */
function extractMainCall(code) {
  const mainPattern = /(?:public\s+)?(?:static\s+)?void\s+main\s*\(\s*String\s*\[\s*\]\s*\w+\s*\)\s*\{/;
  const match = code.match(mainPattern);
  if (!match) {
    // No main method — look for a standalone function call at the end
    const lines = code.trim().split('\n');
    const lastLine = lines[lines.length - 1].trim();
    if (/^\w+\(.*\)\s*;?\s*$/.test(lastLine) && !lastLine.startsWith('return')) {
      return convertLine(lastLine);
    }
    return '';
  }

  // Find the main method body
  const startIdx = code.indexOf(match[0]) + match[0].length;
  const body = extractBracedBlock(code, startIdx);

  // Extract function calls from main body
  const calls = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '{' || trimmed === '}') continue;

    // Skip variable declarations that aren't function calls
    // Match lines that contain a function call (possibly with type prefix for result capture)
    const callMatch = trimmed.match(/^(?:(?:int|long|double|float|boolean|String|char|var|final\s+\w+)\s+\w+\s*=\s*)?(\w+\(.*\))\s*;?\s*$/);
    if (callMatch) {
      calls.push(convertLine(trimmed));
    } else if (trimmed.startsWith('System.out.print')) {
      calls.push(convertLine(trimmed));
    }
  }

  return calls.join('\n') || '';
}

/** Remove the main method from the code. */
function removeMainMethod(code) {
  const mainPattern = /(?:public\s+)?(?:static\s+)?void\s+main\s*\(\s*String\s*\[\s*\]\s*\w+\s*\)\s*\{/;
  const match = code.match(mainPattern);
  if (!match) return code;

  const startIdx = code.indexOf(match[0]);
  const bodyStart = startIdx + match[0].length;
  const body = extractBracedBlock(code, bodyStart);
  const endIdx = bodyStart + body.length + 1; // +1 for closing brace

  return code.substring(0, startIdx) + code.substring(endIdx);
}

/**
 * Extract the content of a braced block starting right after the opening '{'.
 * Returns the content between { and the matching }.
 */
function extractBracedBlock(code, startIdx) {
  let depth = 1;
  let i = startIdx;
  while (i < code.length && depth > 0) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') depth--;
    if (depth > 0) i++;
  }
  return code.substring(startIdx, i);
}

// ═══════════════════════════════════════════════════════════════════
// Body Converter — handles brace-to-indentation conversion
// ═══════════════════════════════════════════════════════════════════

function convertBody(code, memberVars = []) {
  const lines = code.split('\n');
  const result = [];
  let indentLevel = 0;
  let javaDepth = 0;

  // Track whether next line should have extra indent (braceless if/else)
  let pendingIndent = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Detect braces before processing line
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;

    // ── Handle closing braces at start of line (e.g. "} else {") ──────
    if (line.startsWith('}')) {
      indentLevel = Math.max(0, indentLevel - 1);
      javaDepth = Math.max(0, javaDepth - 1);
      
      // If the line is just "}", we skip processing but keep the new javaDepth
      if (line === '}') {
        continue;
      }
    }

    // ── Method signature ─────────────────────────────────────────
    const methodMatch = line.match(
      /^(?:public\s+)?(?:private\s+)?(?:protected\s+)?(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:int|long|double|float|boolean|void|String|char|short|byte|Object|\w+(?:<[^>]+>)?(?:\[\])*)\s+(\w+)\s*\(([^)]*)\)\s*\{?\s*$/
    );
    
    if (methodMatch && !line.includes('=') && !line.includes('new ')) {
      const funcName = methodMatch[1];
      const params = parseParams(methodMatch[2]);
      result.push(indent(indentLevel) + `def ${funcName}(${params}):`);

      indentLevel++;
      javaDepth++;
      
      // Inject global declarations for member variables
      memberVars.forEach(v => {
        result.push(indent(indentLevel) + `global ${v.name}`);
      });

      continue;
    }

    // ── Convert the line ─────────────────────────────────────────
    const endsWithBrace = line.endsWith('{');
    const cleanLine = endsWithBrace ? line.slice(0, -1).trim() : line;

    // Skip member variables (they were moved to top level in javaToPython)
    if (javaDepth === 0 && !methodMatch && !line.includes('(')) {
      const isVar = cleanLine.match(/^(?:static\s+)?(?:final\s+)?(?:int|long|double|float|boolean|String|char|short|byte|var|Object|Long|Integer|Double|Float|Boolean|Character|\w+(?:<[^>]+>)?(?:\[\])*)\s+(\w+)\s*(?:=\s*(.+))?;?$/);
      if (isVar) {
        if (endsWithBrace) javaDepth++;
        continue;
      }
    }

    // Convert and push
    const converted = convertLine(cleanLine);
    if (converted !== null && converted.trim()) {
      const actualIndent = pendingIndent ? indentLevel + 1 : indentLevel;
      const convertedLines = converted.split('\n');
      const indented = convertedLines.map(cl => indent(actualIndent) + cl).join('\n');
      result.push(indented);
      pendingIndent = false;
    }

    if (endsWithBrace && !methodMatch) {
      indentLevel++;
      javaDepth++;
    }

    // Track braceless indentation
    if (!endsWithBrace && converted && converted.endsWith(':') && i + 1 < lines.length) {
      if (lines[i+1].trim() !== '{') pendingIndent = true;
    }
  }

  return result.join('\n');
}

/** Convert Java method params to Python: "int n, String s" → "n, s" */
function parseParams(raw) {
  if (!raw.trim()) return '';
  return raw
    .split(',')
    .map(p => {
      const parts = p.trim().split(/\s+/);
      return parts[parts.length - 1].replace(/\[\]/g, '');
    })
    .join(', ');
}

/** Create indentation string. */
function indent(level) {
  return '    '.repeat(level);
}

// ═══════════════════════════════════════════════════════════════════
// Line Converter — transforms individual Java lines to Python
// ═══════════════════════════════════════════════════════════════════

function convertLine(line) {
  if (!line || !line.trim()) return '';
  line = line.trim();

  // Remove trailing semicolons
  if (line.endsWith(';')) {
    line = line.slice(0, -1).trim();
  }

  // Remove trailing braces (already handled by body converter)
  if (line === '}' || line === '{') return '';

  // ── if statement ───────────────────────────────────────────────
  const ifMatch = line.match(/^if\s*\((.+)\)\s*(.*)$/);
  if (ifMatch) {
    const condition = convertExpression(ifMatch[1].trim());
    const body = ifMatch[2]?.trim();
    if (body && body !== '{' && body !== '') {
      // Single-line if: if (cond) return x;
      const convertedBody = convertLine(body);
      return `if ${condition}:\n${indent(1)}${convertedBody}`;
    }
    return `if ${condition}:`;
  }

  // ── else if ────────────────────────────────────────────────────
  const elifMatch = line.match(/^(?:\}\s*)?else\s+if\s*\((.+)\)\s*(.*)$/);
  if (elifMatch) {
    const condition = convertExpression(elifMatch[1].trim());
    const body = elifMatch[2]?.trim();
    if (body && body !== '{' && body !== '') {
      const convertedBody = convertLine(body);
      return `elif ${condition}:\n${indent(1)}${convertedBody}`;
    }
    return `elif ${condition}:`;
  }

  // ── else ───────────────────────────────────────────────────────
  const elseMatch = line.match(/^(?:\}\s*)?else\s*(.*)$/);
  if (elseMatch) {
    const body = elseMatch[1]?.trim();
    if (body && body !== '{' && body !== '') {
      const convertedBody = convertLine(body);
      return `else:\n${indent(1)}${convertedBody}`;
    }
    return `else:`;
  }

  // ── return statement ───────────────────────────────────────────
  const returnMatch = line.match(/^return\s+(.*)$/);
  if (returnMatch) {
    let expr = returnMatch[1].trim();
    // Handle assignment in return: return dp[ind] = res;
    const assignInReturn = expr.match(/^([^=]+)\s*=\s*([^=]+)$/);
    if (assignInReturn && (assignInReturn[1].includes('[') || !assignInReturn[1].includes(' '))) {
      const target = assignInReturn[1].trim();
      const val = convertExpression(assignInReturn[2]);
      return `${target} = ${val}\nreturn ${target}`;
    }
    return `return ${convertExpression(expr)}`;
  }
  if (line === 'return') return 'return';

  // ── Variable declaration with type → strip type ────────────────
  const varDeclMatch = line.match(
    /^(?:final\s+)?(?:int|long|double|float|boolean|String|char|short|byte|var|Object|\w+(?:<[^>]+>)?(?:\[\])*)\s+(\w+)\s*=\s*(.+)$/
  );
  if (varDeclMatch) {
    const varName = varDeclMatch[1];
    const value = convertExpression(varDeclMatch[2]);
    return `${varName} = ${value}`;
  }

  // ── Multiple variable declaration (int a, b, c;) — rare but handle ─
  const multiVarMatch = line.match(
    /^(?:int|long|double|float|boolean|String|char|short|byte)\s+([\w,\s]+)$/
  );
  if (multiVarMatch) {
    // Just skip uninitialized declarations
    return '';
  }

  // ── Assignment without type ────────────────────────────────────
  const assignMatch = line.match(/^(\w+(?:\[.+?\])?)\s*([+\-*/]?=)\s*(.+)$/);
  if (assignMatch) {
    return `${assignMatch[1]} ${assignMatch[2]} ${convertExpression(assignMatch[3])}`;
  }

  // ── for loop ───────────────────────────────────────────────────
  const forMatch = line.match(/^for\s*\(\s*(?:int\s+)?(\w+)\s*=\s*(\d+)\s*;\s*\w+\s*(<|<=|>|>=)\s*(.+?)\s*;\s*\w+\s*(\+\+|--)\s*\)/);
  if (forMatch) {
    const varName = forMatch[1];
    const start = forMatch[2];
    const op = forMatch[3];
    const end = convertExpression(forMatch[4]);
    const direction = forMatch[5];

    if (direction === '++') {
      if (op === '<') return `for ${varName} in range(${start}, ${end}):`;
      if (op === '<=') return `for ${varName} in range(${start}, ${end} + 1):`;
    } else {
      if (op === '>') return `for ${varName} in range(${start}, ${end}, -1):`;
      if (op === '>=') return `for ${varName} in range(${start}, ${end} - 1, -1):`;
    }
  }

  // ── while loop ─────────────────────────────────────────────────
  const whileMatch = line.match(/^while\s*\((.+)\)$/);
  if (whileMatch) {
    return `while ${convertExpression(whileMatch[1])}:`;
  }

  // ── System.out.println ─────────────────────────────────────────
  if (line.startsWith('System.out.print')) {
    const printMatch = line.match(/System\.out\.println?\((.*)?\)/);
    if (printMatch) {
      return `print(${convertExpression(printMatch[1] || '')})`;
    }
  }

  // ── Standalone function call ───────────────────────────────────
  if (/^\w+\(.*\)$/.test(line)) {
    return convertExpression(line);
  }

  // ── Fallthrough: return the line with basic expression conversion ─
  return convertExpression(line);
}

// ═══════════════════════════════════════════════════════════════════
// Expression Converter
// ═══════════════════════════════════════════════════════════════════

function convertExpression(expr) {
  if (!expr) return '';
  let e = expr.trim();

  // Remove trailing semicolons
  if (e.endsWith(';')) e = e.slice(0, -1).trim();

  // Boolean operators
  e = e.replace(/\s*&&\s*/g, ' and ');
  e = e.replace(/\s*\|\|\s*/g, ' or ');

  // Unary not: !expr → not expr (but not != )
  e = e.replace(/!(?!=)\s*/g, 'not ');

  // Literals
  e = e.replace(/\btrue\b/g, 'True');
  e = e.replace(/\bfalse\b/g, 'False');
  e = e.replace(/\bnull\b/g, 'None');

  // Math methods
  e = e.replace(/Math\.max\(/g, 'max(');
  e = e.replace(/Math\.min\(/g, 'min(');
  e = e.replace(/Math\.abs\(/g, 'abs(');
  e = e.replace(/Math\.pow\(([^,]+),\s*([^)]+)\)/g, '($1 ** $2)');
  e = e.replace(/Math\.sqrt\(/g, 'int(($1) ** 0.5)');
  e = e.replace(/Math\.floor\(([^)]+)\)/g, 'int($1)');

  // String methods
  e = e.replace(/\.length\(\)/g, '.__len__()');
  e = e.replace(/\.length\b/g, '.__len__()');
  // Actually, .length for arrays → len()
  e = e.replace(/(\w+)\.__len__\(\)/g, 'len($1)');

  // Array creation: new int[n] → [0] * n, new Object[n] -> [None] * n
  e = e.replace(/new\s+(?:int|long|double|float|char|boolean|short|byte)\[([^\]]+)\]/g, '[0] * $1');
  e = e.replace(/new\s+(?:\w+)(?:\s*<[^>]+>)?\[([^\]]+)\]/g, '[None] * $1');

  // new String[n] → [None] * n or [""] * n
  e = e.replace(/new\s+String\[([^\]]+)\]/g, '[""] * $1');

  // Integer.parseInt → int()
  e = e.replace(/Integer\.parseInt\(/g, 'int(');

  // String.valueOf → str()
  e = e.replace(/String\.valueOf\(/g, 'str(');

  // .charAt(i) → [i]
  e = e.replace(/\.charAt\(([^)]+)\)/g, '[$1]');

  // .substring(a, b) → [a:b]
  e = e.replace(/\.substring\(([^,]+),\s*([^)]+)\)/g, '[$1:$2]');

  // .equals("...") → == "..."
  e = e.replace(/\.equals\(([^)]+)\)/g, ' == $1');

  // Casting: (int) x -> int(x)
  // Handle (int)rec(0, s) or (int)(a+b)
  const types = 'int|long|double|float|short|byte|char|Integer|Long|Double|Float|Boolean|String';
  e = e.replace(new RegExp(`\\((${types})\\)\\s*(\\([^)]+\\))`, 'g'), 'int($2)');
  e = e.replace(new RegExp(`\\((${types})\\)\\s*(\\w+\\([^)]+\\))`, 'g'), 'int($2)');
  e = e.replace(new RegExp(`\\((${types})\\)\\s*([^+\\-*/=<>!&|% ]+)`, 'g'), 'int($2)');

  // Ternary: cond ? a : b → a if cond else b
  const ternaryMatch = e.match(/^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$/);
  if (ternaryMatch) {
    const cond = convertExpression(ternaryMatch[1]);
    const ifTrue = convertExpression(ternaryMatch[2]);
    const ifFalse = convertExpression(ternaryMatch[3]);
    e = `${ifTrue} if ${cond} else ${ifFalse}`;
  }

  return e;
}
