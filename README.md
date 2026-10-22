# CodeGalaxy 🌌

**Understand every line. See every change.**

CodeGalaxy is an educational code-execution visualizer. It helps learners see how variables, loops, assignments, and program output change as a program runs.

## MVP features

- Editable C source panel with a sample program
- Step forward, step backward, play/pause, and reset controls
- Current-line highlighting and an execution timeline
- Variable inspector and an illustrative stack/memory panel
- Program output panel and basic trace explanations
- Small educational trace engine for integer declarations, simple arithmetic assignments, increment/decrement, braced `while` loops, and simple `printf` calls

## Important limitation

This is an educational trace engine, **not a full C compiler**. It supports a deliberately limited subset of C and reports unsupported statements instead of pretending arbitrary code ran. Pointers, arrays, function calls, `for` loops, and real compiler integration are future milestones. The memory addresses shown are illustrative, not actual process addresses.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Create a production build:

```bash
npm run build
npm run preview
```

## Roadmap

1. Improve syntax support and diagnostics
2. Add arrays, functions, call-stack frames, and pointer visualization
3. Add real C execution through an isolated compiler/runtime sandbox
4. Add guided lessons and shareable examples
5. Add Python and C++ visualizers

## Security

Never execute arbitrary user-submitted code directly on a production server. A real compiler integration must run in a properly isolated sandbox with CPU, memory, filesystem, and execution-time limits.
