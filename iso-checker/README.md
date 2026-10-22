# CodeGalaxy ISO Lab

A standalone, static browser tool for inspecting Linux ISO files. It is kept under `iso-checker/` so the existing CodeGalaxy app and its build setup remain unchanged.

## Current features

- Choose or drag in an `.iso` file.
- Read the file locally in the browser (no upload endpoint exists).
- Calculate a SHA-256 digest using Web Crypto.
- Scan ISO 9660 volume descriptors for a primary volume descriptor, an El Torito boot record, and a descriptor terminator.
- Display a browser-based VM panel with experimental v86 integration.

**Important:** structural checks are indicators, not a full ISO validation or malware scan. A hash proves only which bytes were hashed; authenticity requires comparing it to a checksum obtained from a trusted publisher source.

## Run locally

Serve this directory over HTTP (Web Crypto and emulator assets work best in a secure context):

```bash
cd iso-checker
python3 -m http.server 8080
```

Open http://localhost:8080.

## Enable the experimental browser emulator

The UI's VM button requires the official v86 browser build and BIOS assets. This repository intentionally does not commit compiled emulator binaries.

1. Read the upstream v86 project's current build and distribution instructions: https://github.com/copy/v86
2. Obtain a trusted, compatible browser build and place the following files under `iso-checker/v86/`:
   - `libv86.js` (loaded before `app.js` in `index.html`)
   - `v86.wasm`
   - `seabios.bin`
   - `vgabios.bin`
3. Add this before `app.js` in `index.html`:
   `<script src="./v86/libv86.js" defer></script>`
4. Reload the page and try a small, compatible x86 Linux image.

v86 is a JavaScript/WebAssembly x86 emulator, not a general-purpose hardware virtualization host. Modern Linux installers, 64-bit-only images, graphics-heavy environments, and large images may not boot or may run very slowly. Compatibility must be tested per distribution. The app currently passes the selected ISO as a CD-ROM buffer; this path is experimental and may need adapting to the upstream v86 API version you install.

## Deploy to Cloudflare Pages (Free plan)

Create a Pages project connected to this repository and set the **root directory** to `iso-checker`. No build command is required; use `/ ` as the output directory if the dashboard asks for a build output directory, or deploy the folder directly with Wrangler Pages.

The page is static, so it needs no Worker API, server, or R2 bucket for the current local-first checker. ISO bytes stay in the user's browser. Keep the emulator assets self-hosted in the same Pages project to avoid third-party runtime dependency drift.

## Safety and limitations

- Only select images you trust. Do not treat browser emulation as a secure malware-analysis sandbox.
- The current checker reads the whole ISO into browser memory to calculate its SHA-256 and pass its buffer to the emulator; very large images may exhaust memory.
- Do not expose a public VM launcher without authentication, quotas, per-VM isolation, strict timeouts, and network/filesystem controls.
- A server-side QEMU/KVM service would be a separate future component and is not hosted by a Cloudflare Worker.
