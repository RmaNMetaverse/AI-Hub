/* global lucide */

const libraryType = window.__AI_HUB_LIBRARY_TYPE__;
const permissions = window.__AI_HUB_PERMISSIONS__ || {};
const maxUploadBytes = Number(window.__AI_HUB_MAX_UPLOAD_BYTES__ || 0);
let items = window.__AI_HUB_LIBRARY_ITEMS__ || [];
let activePromptId = null;
let query = "";
let category = "all";
let kind = "all";

const grid = document.querySelector("#libraryGrid");
const empty = document.querySelector("#libraryEmpty");
const count = document.querySelector("#libraryCount");
const toast = document.querySelector("#libraryToast");
const modal = document.querySelector("#libraryModal");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function showToast(message) {
  toast.querySelector("span").textContent = message;
  toast.classList.remove("translate-y-4", "opacity-0");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("translate-y-4", "opacity-0"), 2500);
}

function mediaPreview(file, compact = false) {
  const height = compact ? "h-28" : "aspect-video";
  if (file.kind === "image" && !String(file.mime_type).includes("svg")) return `<img src="${escapeHtml(file.content_url)}" alt="${escapeHtml(file.original_name)}" loading="lazy" class="${height} w-full object-cover" />`;
  if (file.kind === "video") return `<video src="${escapeHtml(file.content_url)}" muted preload="metadata" class="${height} w-full bg-black object-cover"></video>`;
  if (file.kind === "audio") return `<div class="${height} grid place-items-center bg-black/20 text-acid"><i data-lucide="audio-lines" class="h-7 w-7"></i></div>`;
  const icons = { document: "file-text", archive: "archive", other: "file-box" };
  return `<div class="${height} grid place-items-center bg-black/20 text-zinc-700"><i data-lucide="${icons[file.kind] || "file-box"}" class="h-7 w-7"></i></div>`;
}

function promptCard(prompt) {
  const previews = prompt.assets.slice(0, 3).map((asset) => `<div class="relative overflow-hidden rounded-xl border border-white/[0.06] bg-black/20"><a href="${escapeHtml(asset.content_url)}" target="_blank" rel="noopener" class="block">${mediaPreview(asset, true)}<span class="absolute inset-x-0 bottom-0 truncate bg-black/70 px-2 py-1 pr-8 text-[8px] text-zinc-400">${escapeHtml(asset.original_name)}</span></a>${permissions.canManageLibraries ? `<button class="delete-prompt-asset absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/75 text-red-300/70" data-prompt-asset-id="${asset.id}" title="Delete example"><i data-lucide="x" class="h-3 w-3"></i></button>` : ""}</div>`).join("");
  return `<article class="rounded-3xl border border-white/[0.07] bg-[#101113] p-5" data-prompt-id="${prompt.id}">
    <div class="flex items-start justify-between gap-3"><div class="min-w-0"><h2 class="text-lg font-semibold text-zinc-100">${escapeHtml(prompt.title)}</h2><div class="mt-1 text-[10px] text-zinc-700">By ${escapeHtml(prompt.created_by_name || "Unknown")} · ${prompt.asset_count || prompt.assets.length} examples</div></div>${permissions.canManageLibraries ? `<button class="delete-prompt icon-button h-8 w-8 shrink-0 text-red-300/55" title="Delete prompt"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>` : ""}</div>
    <div class="mt-3 flex flex-wrap gap-1.5">${prompt.tags.map((tag) => `<span class="rounded-full border border-white/[0.07] px-2 py-1 text-[8px] text-zinc-600">${escapeHtml(tag)}</span>`).join("")}</div>
    <pre class="mt-4 max-h-44 overflow-hidden whitespace-pre-wrap rounded-2xl border border-white/[0.06] bg-black/20 p-4 font-sans text-xs leading-6 text-zinc-400">${escapeHtml(prompt.prompt)}</pre>
    ${prompt.negative_prompt ? `<details class="mt-3 text-[10px] text-zinc-600"><summary class="cursor-pointer">Negative prompt</summary><p class="mt-2 whitespace-pre-wrap leading-5">${escapeHtml(prompt.negative_prompt)}</p></details>` : ""}
    ${previews ? `<div class="mt-4 grid grid-cols-3 gap-2">${previews}</div>` : `<div class="mt-4 rounded-2xl border border-dashed border-white/[0.08] py-7 text-center text-[10px] text-zinc-700">No example assets yet</div>`}
    <div class="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-4"><button class="copy-prompt ghost-button h-9 px-3 text-[10px]"><i data-lucide="copy" class="h-3.5 w-3.5"></i>Copy prompt</button>${permissions.canManageLibraries ? `<button class="add-prompt-assets ghost-button h-9 px-3 text-[10px]"><i data-lucide="paperclip" class="h-3.5 w-3.5"></i>Add examples</button>` : ""}${prompt.assets.length ? `<span class="ml-auto text-[9px] text-zinc-700">${prompt.assets.length} file${prompt.assets.length === 1 ? "" : "s"}</span>` : ""}</div>
  </article>`;
}

function assetCard(asset) {
  return `<article class="group overflow-hidden rounded-3xl border border-white/[0.07] bg-[#101113]" data-asset-id="${asset.id}"><a href="${escapeHtml(asset.content_url)}" target="_blank" rel="noopener" class="block overflow-hidden bg-black/20">${mediaPreview(asset)}</a><div class="p-4"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><div class="text-[9px] font-semibold uppercase tracking-[0.13em] text-acid">${escapeHtml(asset.category)}</div><h2 class="mt-2 truncate text-sm font-semibold text-zinc-200" title="${escapeHtml(asset.title)}">${escapeHtml(asset.title)}</h2></div>${permissions.canManageLibraries ? `<button class="delete-asset icon-button h-8 w-8 shrink-0 text-red-300/55"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>` : ""}</div><p class="mt-2 line-clamp-2 min-h-9 text-[10px] leading-[18px] text-zinc-600">${escapeHtml(asset.description || asset.original_name)}</p><div class="mt-3 flex flex-wrap gap-1">${asset.tags.map((tag) => `<span class="rounded-full bg-white/[0.035] px-2 py-1 text-[8px] text-zinc-600">${escapeHtml(tag)}</span>`).join("")}</div><div class="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-3"><span class="truncate text-[9px] text-zinc-700">${escapeHtml(asset.original_name)} · ${formatBytes(asset.size_bytes)}</span><a href="${escapeHtml(asset.download_url)}" class="icon-button ml-auto h-8 w-8 shrink-0" aria-label="Download"><i data-lucide="download" class="h-3.5 w-3.5"></i></a></div></div></article>`;
}

function filteredItems() {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    const haystack = libraryType === "prompts"
      ? [item.title, item.prompt, item.negative_prompt, item.created_by_name, ...(item.tags || []), ...item.assets.map((asset) => asset.original_name)].join(" ").toLowerCase()
      : [item.title, item.description, item.original_name, item.uploaded_by_name, ...(item.tags || [])].join(" ").toLowerCase();
    return (!needle || haystack.includes(needle))
      && (libraryType !== "assets" || category === "all" || item.category === category)
      && (libraryType !== "assets" || kind === "all" || item.kind === kind);
  });
}

function render() {
  const visible = filteredItems();
  grid.innerHTML = visible.map(libraryType === "prompts" ? promptCard : assetCard).join("");
  count.textContent = `${visible.length} of ${items.length} ${libraryType === "prompts" ? "prompts" : "assets"}`;
  empty.classList.toggle("hidden", visible.length > 0);
  bindCards();
  lucide.createIcons();
}

function bindCards() {
  grid.querySelectorAll(".copy-prompt").forEach((button) => button.addEventListener("click", async () => {
    const prompt = items.find((item) => item.id === Number(button.closest("[data-prompt-id]").dataset.promptId));
    await navigator.clipboard.writeText(prompt.prompt);
    showToast("Prompt copied");
  }));
  grid.querySelectorAll(".add-prompt-assets").forEach((button) => button.addEventListener("click", () => {
    activePromptId = Number(button.closest("[data-prompt-id]").dataset.promptId);
    document.querySelector("#promptAssetPicker").click();
  }));
  grid.querySelectorAll(".delete-prompt").forEach((button) => button.addEventListener("click", async () => {
    const id = Number(button.closest("[data-prompt-id]").dataset.promptId);
    const prompt = items.find((item) => item.id === id);
    if (!window.confirm(`Delete “${prompt.title}” and its example assets?`)) return;
    const response = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    if (!response.ok) return showToast((await response.json()).error || "Could not delete prompt");
    items = items.filter((item) => item.id !== id); render(); showToast("Prompt deleted");
  }));
  grid.querySelectorAll(".delete-prompt-asset").forEach((button) => button.addEventListener("click", async () => {
    const id = Number(button.dataset.promptAssetId);
    if (!window.confirm("Delete this example asset and its stored file?")) return;
    const response = await fetch(`/api/prompt-assets/${id}`, { method: "DELETE" });
    if (!response.ok) return showToast((await response.json()).error || "Could not delete example asset");
    await refreshPrompts();
    showToast("Example asset deleted");
  }));
  grid.querySelectorAll(".delete-asset").forEach((button) => button.addEventListener("click", async () => {
    const id = Number(button.closest("[data-asset-id]").dataset.assetId);
    const asset = items.find((item) => item.id === id);
    if (!window.confirm(`Delete “${asset.title}” and its stored file?`)) return;
    const response = await fetch(`/api/library-assets/${id}`, { method: "DELETE" });
    if (!response.ok) return showToast((await response.json()).error || "Could not delete asset");
    items = items.filter((item) => item.id !== id); render(); showToast("Asset deleted");
  }));
}

function openModal() { modal?.classList.remove("hidden"); modal?.classList.add("flex"); requestAnimationFrame(() => modal?.querySelector(".modal-card")?.classList.add("open")); }
function closeModal() { modal?.querySelector(".modal-card")?.classList.remove("open"); setTimeout(() => { modal?.classList.add("hidden"); modal?.classList.remove("flex"); }, 180); }

async function refreshPrompts() {
  const response = await fetch("/api/prompts");
  if (response.ok) { items = await response.json(); render(); }
}

async function uploadPromptFiles(promptId, files) {
  for (const file of files) {
    if (maxUploadBytes && file.size > maxUploadBytes) throw new Error(`${file.name} exceeds the upload limit`);
    const data = new FormData(); data.append("file", file);
    const response = await fetch(`/api/prompts/${promptId}/assets`, { method: "POST", body: data });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Could not upload ${file.name}`);
  }
}

document.querySelector("#librarySearch")?.addEventListener("input", (event) => { query = event.target.value; render(); });
document.querySelectorAll(".asset-category-filter").forEach((select) => select.addEventListener("change", (event) => {
  category = event.target.value;
  document.querySelectorAll(".asset-category-filter").forEach((other) => { other.value = category; });
  render();
}));
document.querySelectorAll(".asset-kind-filter").forEach((select) => select.addEventListener("change", (event) => {
  kind = event.target.value;
  document.querySelectorAll(".asset-kind-filter").forEach((other) => { other.value = kind; });
  render();
}));
document.querySelector("#addLibraryItem")?.addEventListener("click", openModal);
document.querySelectorAll(".library-modal-close").forEach((button) => button.addEventListener("click", closeModal));
modal?.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
document.querySelector(".library-mobile-menu")?.addEventListener("click", () => document.querySelector(".app-sidebar").classList.toggle("mobile-open"));
document.querySelector(".library-logout")?.addEventListener("click", async () => { await fetch("/auth/logout", { method: "POST" }); window.location.assign("/login"); });
document.querySelectorAll("[data-planned-feature]").forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.plannedFeature} is planned for a future update`)));

document.querySelector("#promptAssetPicker")?.addEventListener("change", async (event) => {
  const files = [...event.target.files]; event.target.value = "";
  if (!activePromptId || !files.length) return;
  try { await uploadPromptFiles(activePromptId, files); await refreshPrompts(); showToast("Example assets added"); }
  catch (error) { showToast(error.message); }
});

document.querySelector("#libraryForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    if (libraryType === "prompts") {
      const data = new FormData(form);
      const files = [...form.elements.files.files];
      const response = await fetch("/api/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: data.get("title"), tags: data.get("tags"), prompt: data.get("prompt"), negative_prompt: data.get("negative_prompt") }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save prompt");
      await uploadPromptFiles(payload.id, files);
      await refreshPrompts();
      showToast("Prompt saved");
    } else {
      const data = new FormData(form);
      const file = data.get("file");
      if (maxUploadBytes && file.size > maxUploadBytes) throw new Error(`${file.name} exceeds the upload limit`);
      const response = await fetch("/api/library-assets", { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not upload asset");
      items.unshift(payload); render(); showToast("Asset uploaded");
    }
    form.reset(); closeModal();
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});

document.addEventListener("keydown", (event) => { if (event.key === "Escape" && modal?.classList.contains("flex")) closeModal(); });
render();
