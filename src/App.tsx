import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, Braces, Check, ChevronDown,
  CircleHelp, Code2, Command, Copy, Cpu, FileCode2, Gauge, GitBranch,
  Layers3, Play, RotateCcw, Search, Settings2, SkipBack, SkipForward,
  Sparkles, Square, Terminal, WandSparkles, X
} from "lucide-react";

const starterCode = `#include <stdio.h>

int main() {
    int i = 0;
    int total = 0;

    while (i < 5) {
        total = total + i;
        i++;
    }

    printf("Total: %d\\n", total);
    return 0;
}`;

type Variables = Record<string, number>;
type Snapshot = {
  line: number;
  vars: Variables;
  output: string[];
  explanation: string;
  action: string;
  finished?: boolean;
};
type BuildResult = { steps: Snapshot[]; error?: string };

function evaluate(expr: string, vars: Variables): number {
  const tokens = expr.match(/[A-Za-z_]\w*|\d+|[()+\-*/%]/g) ?? [];
  let pos = 0;
  const primary = (): number => {
    const token = tokens[pos++];
    if (token === "(") {
      const value = sum();
      if (tokens[pos++] !== ")") throw new Error("Missing closing parenthesis.");
      return value;
    }
    if (token === "-") return -primary();
    if (token && /^\d+$/.test(token)) return Number(token);
    if (token && /^[A-Za-z_]\w*$/.test(token)) {
      if (!(token in vars)) throw new Error(`Variable "${token}" is not defined yet.`);
      return vars[token];
    }
    throw new Error("Unsupported expression.");
  };
  const product = (): number => {
    let value = primary();
    while (["*", "/", "%"].includes(tokens[pos])) {
      const op = tokens[pos++];
      const rhs = primary();
      if ((op === "/" || op === "%") && rhs === 0) throw new Error("Division by zero.");
      value = op === "*" ? value * rhs : op === "/" ? Math.trunc(value / rhs) : value % rhs;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[pos] === "+" || tokens[pos] === "-") {
      const op = tokens[pos++];
      const rhs = product();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  };
  if (!tokens.length) throw new Error("Empty expression.");
  const result = sum();
  if (pos !== tokens.length || !Number.isFinite(result)) throw new Error("Could not understand this expression.");
  return result;
}

function buildTrace(source: string): BuildResult {
  const lines = source.split("\n");
  const vars: Variables = {};
  const output: string[] = [];
  const steps: Snapshot[] = [];
  const loops = new Map<number, { end: number; condition: string }>();
  const endToStart = new Map<number, number>();
  const loopStack: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*while\s*\((.+)\)\s*\{?\s*$/);
    if (!match) continue;
    let depth = lines[i].includes("{") ? 1 : 0;
    let end = i;
    if (depth === 0) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].includes("{")) { depth = 1; break; }
      }
    }
    if (depth === 0) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].includes("{")) depth++;
      if (lines[j].includes("}")) depth--;
      if (depth === 0) { end = j; break; }
    }
    if (end > i) {
      loops.set(i, { end, condition: match[1] });
      endToStart.set(end, i);
    }
  }

  const compare = (condition: string): boolean => {
    const match = condition.match(/^(.+?)\s*(<=|>=|==|!=|<|>)\s*(.+)$/);
    if (!match) throw new Error("Use a simple comparison such as i < 5 in while conditions.");
    const a = evaluate(match[1], vars), b = evaluate(match[3], vars);
    switch (match[2]) {
      case "<": return a < b;
      case ">": return a > b;
      case "<=": return a <= b;
      case ">=": return a >= b;
      case "==": return a === b;
      default: return a !== b;
    }
  };

  const save = (line: number, explanation: string, action: string, finished = false) => {
    steps.push({ line: Math.max(0, Math.min(line, lines.length - 1)), vars: { ...vars }, output: [...output], explanation, action, finished });
  };

  let pc = 0, safety = 0;
  save(0, "Ready to explore. Step through the program to see how state changes.", "Ready");
  try {
    while (pc < lines.length && safety++ < 500) {
      const raw = lines[pc];
      const line = raw.trim();
      if (!line || line.startsWith("#") || line === "{" || line === "}" || line === "int main() {") { pc++; continue; }
      if (line.startsWith("return")) {
        save(pc, "The return statement exits main().", "Return");
        pc = lines.length;
        break;
      }
      if (loops.has(pc)) {
        const loop = loops.get(pc)!;
        if (compare(loop.condition)) {
          if (loopStack[loopStack.length - 1] !== pc) loopStack.push(pc);
          save(pc, `Condition is true: ${loop.condition.trim()}. Enter the loop body.`, "Condition true");
          pc++;
        } else {
          save(pc, `Condition is false: ${loop.condition.trim()}. Leave the loop.`, "Condition false");
          if (loopStack[loopStack.length - 1] === pc) loopStack.pop();
          pc = loop.end + 1;
        }
        continue;
      }
      if (endToStart.has(pc) && loopStack[loopStack.length - 1] === endToStart.get(pc)) {
        pc = endToStart.get(pc)!;
        continue;
      }
      if (line.startsWith("printf")) {
        const fmt = line.match(/printf\s*\(\s*"([^"]*)"(.*)\)\s*;/);
        if (!fmt) throw new Error(`Line ${pc + 1}: only simple printf string formats are supported.`);
        const argsText = fmt[2].replace(/^\s*,\s*/, "").replace(/\);?\s*$/, "");
        const args = argsText ? argsText.split(",").map(s => s.trim()) : [];
        let argIndex = 0;
        const rendered = fmt[1].replace(/%[difs]/g, () => {
          const arg = args[argIndex++];
          return arg ? String(evaluate(arg, vars)) : "?";
        }).replace(/\\n/g, "\n");
        output.push(rendered);
        save(pc, "printf writes the formatted value to the output panel.", "Output");
        pc++;
        continue;
      }
      const declaration = line.match(/^(?:const\s+)?(?:int|long|short)\s+([A-Za-z_]\w*)\s*(?:=\s*(.+?))?;$/);
      if (declaration) {
        const name = declaration[1];
        vars[name] = declaration[2] ? evaluate(declaration[2], vars) : 0;
        save(pc, `Create integer ${name} and initialize it to ${vars[name]}.`, "Declare variable");
        pc++;
        continue;
      }
      const increment = line.match(/^([A-Za-z_]\w*)\s*(\+\+|--);$/);
      if (increment) {
        const name = increment[1];
        if (!(name in vars)) throw new Error(`Line ${pc + 1}: "${name}" is not declared.`);
        vars[name] += increment[2] === "++" ? 1 : -1;
        save(pc, `${name} changes to ${vars[name]}.`, increment[2] === "++" ? "Increment" : "Decrement");
        pc++;
        continue;
      }
      const assignment = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+);$/);
      if (assignment) {
        const name = assignment[1];
        if (!(name in vars)) throw new Error(`Line ${pc + 1}: "${name}" is not declared.`);
        vars[name] = evaluate(assignment[2], vars);
        save(pc, `Update ${name} to ${vars[name]}.`, "Assignment");
        pc++;
        continue;
      }
      throw new Error(`Line ${pc + 1}: this MVP does not support "${line}". Try integer variables, assignments, ++/--, while loops, and printf.`);
    }
    if (safety >= 500) throw new Error("Stopped after 500 steps to prevent an infinite loop.");
    save(Math.max(0, lines.length - 1), "Execution finished. You can step backward to review each change.", "Finished", true);
  } catch (err) {
    return { steps, error: err instanceof Error ? err.message : "Could not trace this program." };
  }
  return { steps };
}

const starterLines = starterCode.split("\n");

export default function App() {
  const [code, setCode] = useState(starterCode);
  const [trace, setTrace] = useState<Snapshot[]>(() => buildTrace(starterCode).steps);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState("700");
  const [activeTab, setActiveTab] = useState("variables");
  const [showHelp, setShowHelp] = useState(false);
  const current = trace[Math.min(cursor, trace.length - 1)];
  const lines = useMemo(() => code.split("\n"), [code]);
  const canGoNext = cursor < trace.length - 1;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setCursor(prev => {
        if (prev >= trace.length - 1) { setIsPlaying(false); return prev; }
        return prev + 1;
      });
    }, Number(speed));
    return () => window.clearInterval(timer);
  }, [isPlaying, speed, trace.length]);

  useEffect(() => {
    if (cursor >= trace.length - 1 && isPlaying) setIsPlaying(false);
  }, [cursor, trace.length, isPlaying]);

  const run = () => {
    const result = buildTrace(code);
    setTrace(result.steps.length ? result.steps : []);
    setCursor(0);
    setError(result.error ?? "");
    setIsPlaying(false);
  };
  const reset = () => { setIsPlaying(false); setCursor(0); };
  const next = () => { setIsPlaying(false); setCursor(c => Math.min(c + 1, trace.length - 1)); };
  const back = () => { setIsPlaying(false); setCursor(c => Math.max(0, c - 1)); };
  const variables = Object.entries(current?.vars ?? {});
  const progress = trace.length > 1 ? (cursor / (trace.length - 1)) * 100 : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="CodeGalaxy home">
          <span className="brand-mark"><Sparkles size={19} /></span>
          <span>code<span className="brand-accent">galaxy</span><span className="brand-dot">.</span></span>
          <span className="beta-pill">BETA</span>
        </a>
        <div className="topbar-center"><span className="status-dot" /> Interactive C Visualizer <span className="slash">/</span> <span className="muted">Workspace</span></div>
        <div className="topbar-actions">
          <button className="icon-button" title="How it works" onClick={() => setShowHelp(v => !v)}><CircleHelp size={17} /></button>
          <button className="icon-button" title="Settings (coming soon)" onClick={() => setShowHelp(v => !v)}><Settings2 size={17} /></button>
          <div className="avatar">CG</div>
        </div>
      </header>

      <main className="workspace">
        <section className="page-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> LEARN BY SEEING</div>
            <h1>Watch your code <span>come alive.</span></h1>
            <p>Step through your program. Understand every variable, loop, and decision.</p>
          </div>
          <div className="heading-badge"><WandSparkles size={15} /> Made for curious minds</div>
        </section>

        {showHelp && <div className="help-banner"><div><strong>How to use CodeGalaxy</strong><p>Click Run trace, then use the step controls to follow the supported C subset. This is an educational tracer, not a full C compiler.</p></div><button className="icon-button" onClick={() => setShowHelp(false)}><X size={16}/></button></div>}

        <section className="toolbar">
          <div className="file-crumb"><span className="file-icon"><FileCode2 size={16}/></span><strong>main.c</strong><span className="crumb-divider">/</span><span className="muted">C Playground</span><ChevronDown size={14}/></div>
          <div className="toolbar-right">
            <span className="language-chip"><span className="c-badge">C</span> C language</span>
            <button className="run-button" onClick={run}><Play size={15} fill="currentColor"/> Run trace <span className="shortcut">⌘ ↵</span></button>
          </div>
        </section>

        <section className="main-grid">
          <div className="editor-panel panel">
            <div className="panel-header">
              <div className="panel-title"><Code2 size={16}/><span>Source code</span><span className="tiny-count">{lines.length} lines</span></div>
              <div className="panel-tools"><span className="language-dot"/> C <button className="mini-icon" title="Restore example" onClick={() => {setCode(starterCode); setError("");}}><RotateCcw size={14}/></button></div>
            </div>
            <div className="editor-body">
              <div className="line-numbers" aria-hidden="true">{lines.map((_, i) => <div key={i} className={current?.line === i && cursor > 0 ? "line-no active" : "line-no"}>{String(i + 1).padStart(2, "0")}</div>)}</div>
              <div className="code-area">
                <div className="code-highlight" aria-hidden="true">{lines.map((line, i) => <div key={i} className={current?.line === i && cursor > 0 ? "code-row current" : "code-row"}><span className="line-marker">{current?.line === i && cursor > 0 ? "›" : " "}</span><span>{highlightLine(line)}</span></div>)}</div>
                <textarea
                  aria-label="C source code editor"
                  spellCheck={false}
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  className="code-input"
                  wrap="off"
                />
              </div>
            </div>
            <div className="editor-footer"><span><span className="green-dot"/> Editor ready</span><span>UTF-8 <i/> C11 subset <i/> Ln {current ? current.line + 1 : 1}, Col 1</span></div>
          </div>

          <div className="inspector-column">
            <div className="panel state-panel">
              <div className="panel-header">
                <div className="panel-title"><Activity size={16}/><span>Live state</span></div>
                <span className="live-label"><span className="green-dot"/> LIVE</span>
              </div>
              <div className="tabs">
                <button className={activeTab === "variables" ? "tab active" : "tab"} onClick={() => setActiveTab("variables")}>Variables <span>{variables.length}</span></button>
                <button className={activeTab === "memory" ? "tab active" : "tab"} onClick={() => setActiveTab("memory")}>Memory <span>{variables.length}</span></button>
              </div>
              {activeTab === "variables" ? (
                <div className="variable-list">
                  {variables.length ? variables.map(([name, value], i) => <div className="variable-row" key={name}><div className="variable-symbol">{name.slice(0,1)}</div><div className="variable-meta"><strong>{name}</strong><span>int <em>·</em> stack</span></div><div className="variable-value">{String(value)}</div><span className={i === 0 ? "change-dot" : "change-dot purple"}/></div>) : <div className="empty-state"><Braces size={22}/><span>No variables yet</span><small>Step through a declaration to inspect it.</small></div>}
                </div>
              ) : (
                <div className="memory-list">
                  {variables.length ? variables.map(([name, value], i) => <div className="memory-row" key={name}><code>0x7ffe{(0x21a0 + i * 4).toString(16)}</code><span className="memory-cell">{value}</span><span className="memory-name">{name}</span></div>) : <div className="empty-state"><Layers3 size={22}/><span>Stack is empty</span><small>Declared integers appear here.</small></div>}
                  <p className="memory-note">Illustrative stack locations for learning; not real process addresses.</p>
                </div>
              )}
              <div className="panel-subfooter"><span><span className="legend-dot lime"/> Current value</span><span><span className="legend-dot violet"/> Stack variable</span></div>
            </div>

            <div className="panel explanation-panel">
              <div className="panel-header"><div className="panel-title"><Sparkles size={15}/><span>What's happening?</span></div><span className="step-chip">STEP {String(cursor + 1).padStart(2, "0")}</span></div>
              <div className="explanation-content">
                <div className="explanation-icon"><WandSparkles size={17}/></div>
                <div><strong>{current?.action ?? "Ready"}</strong><p>{current?.explanation ?? "Run a trace to see how your program works."}</p></div>
              </div>
            </div>
          </div>
        </section>

        <section className="bottom-grid">
          <div className="panel playback-panel">
            <div className="panel-header"><div className="panel-title"><GitBranch size={16}/><span>Execution timeline</span></div><span className="muted small">{Math.min(cursor + 1, trace.length)} of {trace.length} steps</span></div>
            <div className="timeline-track"><div className="timeline-progress" style={{width: `${progress}%`}}/>{trace.map((step, i) => <button key={i} title={`Step ${i + 1}: ${step.action}`} onClick={() => {setIsPlaying(false); setCursor(i);}} className={i === cursor ? "timeline-point active" : i < cursor ? "timeline-point visited" : "timeline-point"} style={{left: `${trace.length > 1 ? (i / (trace.length - 1)) * 100 : 0}%`}} />)}</div>
            <div className="timeline-labels"><span>Start</span><span>Execution</span><span>Complete</span></div>
            <div className="playback-controls">
              <div className="control-group"><button className="control-button" title="Reset" onClick={reset}><RotateCcw size={15}/></button><button className="control-button" title="Step backward" onClick={back} disabled={cursor === 0}><SkipBack size={15}/></button><button className="play-control" title={isPlaying ? "Pause" : "Play"} onClick={() => { if (!canGoNext) setCursor(0); setIsPlaying(v => !v); }}>{isPlaying ? <Square size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}</button><button className="control-button" title="Step forward" onClick={next} disabled={!canGoNext}><SkipForward size={15}/></button></div>
              <div className="speed-control"><Gauge size={15}/><span>Speed</span><select value={speed} onChange={e => setSpeed(e.target.value)} aria-label="Playback speed"><option value="1400">0.5×</option><option value="700">1×</option><option value="300">2×</option></select></div>
            </div>
          </div>
          <div className="panel output-panel">
            <div className="panel-header"><div className="panel-title"><Terminal size={16}/><span>Program output</span></div><span className="terminal-status"><span className="green-dot"/> stdout</span></div>
            <div className="terminal-body"><div className="terminal-prompt"><span>❯</span><code>./main</code></div>{current?.output.length ? current.output.map((line, i) => <pre key={i}>{line}</pre>) : <p className="terminal-placeholder">Output will appear here when printf runs.</p>}{error && <div className="error-message"><X size={14}/><span>{error}</span></div>}</div>
            <div className="terminal-footer"><span><span className="green-dot"/> Process {current?.finished ? "exited" : "ready"}</span><span>{current?.finished ? "exit code 0" : "waiting for trace"}</span></div>
          </div>
        </section>

        <footer className="app-footer"><span>✦ Built for learning, one step at a time.</span><span><span className="footer-key">C</span> Visualizer MVP <span className="footer-divider">·</span> <button onClick={() => setShowHelp(true)}>Supported syntax <ArrowRight size={12}/></button></span></footer>
      </main>
    </div>
  );
}

function highlightLine(line: string) {
  const parts = line.split(/("(?:[^"\\]|\\.)*"|\b(?:int|long|short|return|while|if|else|const|void)\b|\b(?:main|printf)\b|\b\d+\b|#include|\/\/.*$)/g);
  return parts.map((part, i) => {
    let cls = "";
    if (/^".*"$/.test(part)) cls = "syntax-string";
    else if (/^(int|long|short|return|while|if|else|const|void)$/.test(part)) cls = "syntax-keyword";
    else if (/^(main|printf)$/.test(part)) cls = "syntax-function";
    else if (/^\d+$/.test(part)) cls = "syntax-number";
    else if (part === "#include") cls = "syntax-include";
    else if (part.startsWith("//")) cls = "syntax-comment";
    return <span key={i} className={cls}>{part}</span>;
  });
}
