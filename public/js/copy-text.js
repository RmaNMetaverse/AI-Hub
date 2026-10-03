(() => {
  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // The Clipboard API can be denied on an HTTP server. Use the browser's selection fallback.
      }
    }
    const input = document.createElement("textarea");
    const previousFocus = document.activeElement;
    const selection = document.getSelection();
    const previousRanges = selection ? [...Array(selection.rangeCount)].map((_, index) => selection.getRangeAt(index).cloneRange()) : [];
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.append(input);
    try {
      input.focus();
      input.select();
      if (!document.execCommand("copy")) throw new Error("Copy failed");
    } finally {
      input.remove();
      previousFocus?.focus?.({ preventScroll: true });
      if (selection) {
        selection.removeAllRanges();
        previousRanges.forEach((range) => selection.addRange(range));
      }
    }
  }
  window.aiHubCopyText = copyText;

  function decorate(root = document) {
    const fields = [...root.querySelectorAll?.("textarea, [data-copy-text]") || []];
    for (const field of fields) {
      if (field.dataset.copyReady) continue;
      field.dataset.copyReady = "true";
      const wrapper = document.createElement("div");
      wrapper.className = "copy-text-wrap";
      wrapper.style.marginTop = getComputedStyle(field).marginTop;
      field.style.marginTop = "0";
      field.before(wrapper);
      wrapper.append(field);
      field.classList.add("copy-text-field");

      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-text-button";
      const copyIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
      const checkIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
      button.innerHTML = copyIcon;
      button.setAttribute("aria-label", "Copy text");
      button.title = "Copy text";
      let resetTimer;
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = field instanceof HTMLTextAreaElement ? field.value : field.textContent;
        try {
          await copyText(value);
          button.innerHTML = checkIcon;
          button.setAttribute("aria-label", "Copied");
          button.title = "Copied";
        } catch {
          button.setAttribute("aria-label", "Copy failed");
          button.title = "Copy failed";
        }
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          button.innerHTML = copyIcon;
          button.setAttribute("aria-label", "Copy text");
          button.title = "Copy text";
        }, 1800);
      });
      wrapper.append(button);
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    decorate();
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1) {
          if (node.matches("textarea, [data-copy-text]")) decorate(node.parentElement);
          else decorate(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
