/* Shared drag-and-drop enhancement for every file picker. */
(function () {
  function hasDraggedFiles(dataTransfer) {
    return Boolean(dataTransfer && (
      [...(dataTransfer.types || [])].includes("Files")
      || [...(dataTransfer.items || [])].some((item) => item.kind === "file")
      || dataTransfer.files?.length
    ));
  }

  function filesFromTransfer(dataTransfer) {
    return dataTransfer && dataTransfer.files ? [...dataTransfer.files] : [];
  }

  function assignFiles(input, files) {
    if (!input || !files.length) return;
    try {
      const transfer = new DataTransfer();
      (input.multiple ? files : files.slice(0, 1)).forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      // Browsers that do not allow programmatic file assignment still retain
      // the normal browse picker, so dropping simply has no side effect there.
    }
  }

  function zoneFor(input) {
    if (input.closest("[data-file-drop-zone]")) return input.closest("[data-file-drop-zone]");
    const label = input.closest("label");
    if (label) return label;
    const parent = input.parentElement;
    if (!parent) return input;
    return parent;
  }

  function enhance(input) {
    // This picker is opened by the prompt card's "Add examples" action; the
    // visible upload field is the one inside the prompt modal.
    if (input.id === "promptAssetPicker") return;
    if (input.dataset.fileDropBound === "true") return;
    input.dataset.fileDropBound = "true";
    const zone = zoneFor(input);
    zone.dataset.fileDropZone = "true";
    zone.classList.add("file-drop-zone");
    if (zone.tagName === "LABEL" && !zone.id) zone.classList.add("file-drop-field");
    zone.setAttribute("data-file-drop-for", input.id || input.name || "file");

    const setActive = (active) => zone.classList.toggle("file-drop-active", active);
    ["dragenter", "dragover"].forEach((eventName) => zone.addEventListener(eventName, (event) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setActive(true);
    }));
    ["dragleave", "drop"].forEach((eventName) => zone.addEventListener(eventName, (event) => {
      if (!hasDraggedFiles(event.dataTransfer) && !zone.classList.contains("file-drop-active")) return;
      event.preventDefault();
      event.stopPropagation();
      if (eventName === "dragleave" && event.relatedTarget && zone.contains(event.relatedTarget)) return;
      setActive(false);
    }));
    zone.addEventListener("drop", (event) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      assignFiles(input, filesFromTransfer(event.dataTransfer));
    });
    window.addEventListener("dragend", () => setActive(false));
    window.addEventListener("drop", () => setActive(false));
  }

  function init() {
    document.querySelectorAll('input[type="file"]').forEach(enhance);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
