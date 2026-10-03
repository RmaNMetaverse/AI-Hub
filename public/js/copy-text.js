(() => {
  function decorate(root = document) {
    const fields = [...root.querySelectorAll?.("textarea, [data-copy-text]") || []];
    for (const field of fields) {
      if (field.dataset.copyReady) continue;
      field.dataset.copyReady = "true";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mt-2 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-1.5 text-[10px] font-semibold text-zinc-400 transition hover:border-acid/35 hover:text-acid";
      button.textContent = "Copy text";
      button.setAttribute("aria-label", "Copy text");
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = field instanceof HTMLTextAreaElement ? field.value : field.textContent;
        try {
          await navigator.clipboard.writeText(value);
          button.textContent = "Copied";
          setTimeout(() => { button.textContent = "Copy text"; }, 1800);
        } catch { button.textContent = "Copy failed"; }
      });
      field.after(button);
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
