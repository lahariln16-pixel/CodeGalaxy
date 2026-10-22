# CodeGalaxy

**See your code think.**

CodeGalaxy is an interactive learning prototype that helps beginners understand how programs execute through guided, step-by-step visual traces.

## Current prototype

Open `index.html` in a browser or use GitHub Pages to try the static demo.

- **Three guided C examples:** for loops, array traversal, and function calls
- **Step controls:** previous, next, play/pause, reset, and jump to the end
- **Variable inspector:** watch values change between steps
- **Array and memory view:** inspect indexed elements
- **Call stack:** see the current function frame
- **Program output:** follow the output produced by the example
- **Responsive layout:** desktop and mobile-friendly UI
- **Keyboard controls:** left/right arrows to step, space to play/pause

## Important prototype limitation

The current version plays curated example traces. It does **not** compile or execute arbitrary C code, and the source examples are read-only. A future milestone should add a real, sandboxed execution engine and generate trace events from actual program execution.

## Roadmap

- [x] Initial interactive UI prototype
- [x] Guided traces for loops, arrays, and functions
- [ ] Real C execution and trace capture
- [ ] Pointer and memory-address visualization
- [ ] Editable code with clear compile/runtime errors
- [ ] Learning exercises and shareable examples

## Safety

Never execute untrusted code directly on a production server. Real code execution should use an isolated sandbox with strict CPU, memory, network, and time limits.
