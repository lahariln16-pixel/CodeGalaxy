const $ = (id) => document.getElementById(id);
const fileInput = $("iso-file");
const dropzone = $("dropzone");
const checkButton = $("check-button");
const clearButton = $("clear-button");
const bootButton = $("boot-button");
const stopButton = $("stop-button");
let selectedFile = null;
let selectedBuffer = null;
let emulator = null;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + units[unit];
}
function setStatus(message) { $("status").textContent = message; }
function setVmStatus(message) { $("vm-status").textContent = message; }
function addCheck(title, detail, state = "good") {
  const row = document.createElement("div");
  row.className = "check-row";
  const icon = document.createElement("span");
  icon.className = "check-icon" + (state === "warn" ? " warn" : "");
  icon.textContent = state === "warn" ? "!" : "✓";
  const copy = document.createElement("div");
  copy.className = "check-copy";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const description = document.createElement("span");
  description.textContent = detail;
  copy.append(heading, description);
  row.append(icon, copy);
  $("checks").append(row);
}
function isoSectorInfo(bytes) {
  const sectorSize = 2048;
  const scanSectors = Math.min(Math.floor(bytes.length / sectorSize), 64);
  let primaryVolumeDescriptor = false;
  let bootRecord = false;
  let terminator = false;
  for (let sector = 16; sector < scanSectors; sector++) {
    const offset = sector * sectorSize;
    const type = bytes[offset];
    const identifier = String.fromCharCode(...bytes.subarray(offset + 1, offset + 6));
    if (identifier !== "CD001" || bytes[offset + 6] !== 1) continue;
    if (type === 1) primaryVolumeDescriptor = true;
    if (type === 0 && String.fromCharCode(...bytes.subarray(offset + 7, offset + 30)).includes("EL TORITO SPECIFICATION")) bootRecord = true;
    if (type === 255) { terminator = true; break; }
  }
  return { primaryVolumeDescriptor, bootRecord, terminator };
}
async function analyzeFile() {
  if (!selectedFile) return;
  checkButton.disabled = true;
  $("results").classList.add("hidden");
  setStatus("Reading the ISO locally and calculating SHA-256…");
  try {
    // The selected image remains local to this browser tab; it is never sent to a server.
    selectedBuffer = await selectedFile.arrayBuffer();
    const bytes = new Uint8Array(selectedBuffer);
    const digest = await crypto.subtle.digest("SHA-256", selectedBuffer);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const info = isoSectorInfo(bytes);
    $("size-value").textContent = formatBytes(selectedFile.size);
    $("hash-value").textContent = hash;
    $("copy-hash").disabled = false;
    $("checks").replaceChildren();
    addCheck("File readable", "The browser read " + formatBytes(selectedFile.size) + " without a file-read error.");
    addCheck("SHA-256 calculated", hash, "good");
    if (info.primaryVolumeDescriptor) addCheck("ISO 9660 signature found", "A primary volume descriptor was found at the expected ISO sector.");
    else addCheck("ISO 9660 signature not found", "This may not be a standard ISO 9660 image, or it may use another layout. This check alone cannot classify every hybrid image.", "warn");
    if (info.bootRecord) addCheck("El Torito boot record found", "A boot-record descriptor was detected. This is a useful sign for CD/DVD boot support.");
    else addCheck("El Torito boot record not detected", "No El Torito boot record was found in the scanned descriptor area. Some USB/hybrid images use other boot layouts.", "warn");
    if (info.terminator) addCheck("Volume descriptor terminator found", "The ISO descriptor sequence has a terminator.");
    else addCheck("Volume descriptor terminator not found", "No terminator was detected in the scanned area; this is not conclusive for every image.", "warn");
    addCheck("Authenticity", "Not verified. Compare the hash above with a trusted checksum published by the Linux distribution.", "warn");
    $("result-badge").textContent = info.primaryVolumeDescriptor ? "Inspected" : "Needs review";
    $("results").classList.remove("hidden");
    bootButton.disabled = false;
    setStatus("Analysis complete. No file was uploaded.");
    setVmStatus("ISO selected. Browser-emulator support varies by Linux distribution.");
  } catch (error) {
    console.error(error);
    setStatus("Could not analyze this file: " + (error.message || "unknown error"));
  } finally {
    checkButton.disabled = !selectedFile;
  }
}
function chooseFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".iso")) {
    setStatus("Choose a file with the .iso extension.");
    return;
  }
  stopVm();
  selectedFile = file;
  selectedBuffer = null;
  $("file-summary").classList.remove("hidden");
  $("file-summary").replaceChildren();
  const name = document.createElement("strong");
  name.textContent = file.name;
  const detail = document.createElement("span");
  detail.textContent = formatBytes(file.size) + " · Last modified " + new Date(file.lastModified).toLocaleString();
  $("file-summary").append(name, detail);
  checkButton.disabled = false;
  clearButton.disabled = false;
  bootButton.disabled = true;
  $("results").classList.add("hidden");
  setStatus("Ready to analyze. The file remains on this device.");
  setVmStatus("Analyze the ISO before attempting to boot.");
}
function stopVm() {
  if (emulator) {
    try { emulator.stop(); } catch (error) { console.warn("VM stop:", error); }
    emulator = null;
  }
  $("vm-badge").textContent = "Stopped";
  stopButton.disabled = true;
  $("screen_container").replaceChildren();
  const placeholder = document.createElement("div");
  placeholder.className = "screen-placeholder";
  placeholder.innerHTML = '<span class="terminal-icon">⌁_</span><strong>Your virtual display appears here</strong><span>Analyze an ISO, then start the experimental emulator.</span>';
  $("screen_container").append(placeholder);
}
async function bootVm() {
  if (!selectedBuffer) { setVmStatus("Analyze the ISO first."); return; }
  if (typeof window.V86Starter !== "function") {
    setVmStatus("The emulator library is not installed. Follow iso-checker/README.md to add the official v86 browser assets, then reload.");
    return;
  }
  bootButton.disabled = true;
  setVmStatus("Starting emulator. First boot can take a while…");
  $("vm-badge").textContent = "Starting";
  $("screen_container").replaceChildren();
  try {
    emulator = new window.V86Starter({
      wasm_path: "./v86/v86.wasm",
      memory_size: 512 * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      cdrom: { buffer: selectedBuffer },
      bios: { url: "./v86/seabios.bin" },
      vga_bios: { url: "./v86/vgabios.bin" },
      screen_container: $("screen_container"),
      autostart: true,
      disable_keyboard: false,
      disable_mouse: false
    });
    emulator.add_listener("emulator-ready", () => {
      $("vm-badge").textContent = "Running";
      stopButton.disabled = false;
      setVmStatus("Emulator ready. If the display stays blank, this ISO may not be compatible with v86.");
    });
    emulator.add_listener("emulator-started", () => {
      $("vm-badge").textContent = "Running";
      stopButton.disabled = false;
    });
    emulator.add_listener("emulator-stopped", () => {
      $("vm-badge").textContent = "Stopped";
      stopButton.disabled = true;
    });
  } catch (error) {
    console.error(error);
    setVmStatus("Could not start the emulator: " + (error.message || "unknown error"));
    $("vm-badge").textContent = "Error";
    bootButton.disabled = false;
  }
}
fileInput.addEventListener("change", () => chooseFile(fileInput.files && fileInput.files[0]));
dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("dragging"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault(); dropzone.classList.remove("dragging");
  chooseFile(event.dataTransfer && event.dataTransfer.files[0]);
});
checkButton.addEventListener("click", analyzeFile);
clearButton.addEventListener("click", () => {
  stopVm(); selectedFile = null; selectedBuffer = null; fileInput.value = "";
  $("file-summary").classList.add("hidden"); $("results").classList.add("hidden");
  checkButton.disabled = true; clearButton.disabled = true; bootButton.disabled = true;
  $("copy-hash").disabled = true; setStatus("Choose an ISO to begin."); setVmStatus("Select and analyze an ISO first.");
});
$("copy-hash").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("hash-value").textContent); $("copy-hash").textContent = "Copied"; }
  catch { setStatus("Clipboard access was blocked. Select and copy the hash manually."); }
});
bootButton.addEventListener("click", bootVm);
stopButton.addEventListener("click", () => { stopVm(); bootButton.disabled = !selectedBuffer; setVmStatus("VM stopped."); });
window.addEventListener("beforeunload", stopVm);