/* global lucide */

const libraryType = window.__AI_HUB_LIBRARY_TYPE__;
const permissions = window.__AI_HUB_PERMISSIONS__ || {};
const maxUploadBytes = Number(window.__AI_HUB_MAX_UPLOAD_BYTES__ || 0);
let assetTags = window.__AI_HUB_ASSET_TAGS__ || [];
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
const assetViewer = document.querySelector("#assetViewerModal");
const libraryMediaViewer = document.querySelector("#libraryMediaViewer");
let assetTagValues = [];
let pendingTagSave = Promise.resolve();

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
  const previews = prompt.assets.slice(0, 3).map((asset) => `<div class="relative overflow-hidden rounded-xl border border-white/[0.06] bg-black/20"><button type="button" data-library-media-id="${asset.id}" class="block w-full text-left">${mediaPreview(asset, true)}<span class="absolute inset-x-0 bottom-0 truncate bg-black/70 px-2 py-1 pr-8 text-[8px] text-zinc-400">${escapeHtml(asset.original_name)}</span></button>${permissions.canManageLibraries ? `<button class="delete-prompt-asset absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/75 text-red-300/70" data-prompt-asset-id="${asset.id}" title="Delete example"><i data-lucide="x" class="h-3 w-3"></i></button>` : ""}</div>`).join("");
  return `<article class="rounded-3xl border border-white/[0.07] bg-[#101113] p-5" data-prompt-id="${prompt.id}">
    <div class="flex items-start justify-between gap-3"><div class="min-w-0"><h2 class="text-lg font-semibold text-zinc-100">${escapeHtml(prompt.title)}</h2><div class="mt-1 text-[10px] text-zinc-700">By ${escapeHtml(prompt.created_by_name || "Unknown")} · ${prompt.asset_count || prompt.assets.length} examples</div></div>${permissions.canManageLibraries ? `<button class="delete-prompt icon-button h-8 w-8 shrink-0 text-red-300/55" title="Delete prompt"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>` : ""}</div>
    <div class="mt-3 flex flex-wrap gap-1.5">${prompt.tags.map((tag) => `<span class="rounded-full border border-white/[0.07] px-2 py-1 text-[8px] text-zinc-600">${escapeHtml(tag)}</span>`).join("")}</div>
    <pre data-copy-text class="mt-4 max-h-44 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-white/[0.06] bg-black/20 p-4 font-sans text-xs leading-6 text-zinc-400">${escapeHtml(prompt.prompt)}</pre>
    ${prompt.negative_prompt ? `<details class="mt-3 text-[10px] text-zinc-600"><summary class="cursor-pointer">Negative prompt</summary><p data-copy-text class="mt-2 max-h-36 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black/20 p-4 leading-5">${escapeHtml(prompt.negative_prompt)}</p></details>` : ""}
    ${previews ? `<div class="mt-4 grid grid-cols-3 gap-2">${previews}</div>` : `<div class="mt-4 rounded-2xl border border-dashed border-white/[0.08] py-7 text-center text-[10px] text-zinc-700">No example assets yet</div>`}
    <div class="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-4">${permissions.canManageLibraries ? `<button class="add-prompt-assets ghost-button h-9 px-3 text-[10px]"><i data-lucide="paperclip" class="h-3.5 w-3.5"></i>Add examples</button>` : ""}${prompt.assets.length ? `<span class="ml-auto text-[9px] text-zinc-700">${prompt.assets.length} file${prompt.assets.length === 1 ? "" : "s"}</span>` : ""}</div>
  </article>`;
}

function assetCard(asset) {
  const files = asset.files?.length ? asset.files : [asset];
  const primary = files[0];
  return `<article class="group relative overflow-hidden rounded-3xl border border-white/[0.07] bg-[#101113] transition hover:-translate-y-0.5 hover:border-white/20" data-asset-id="${asset.id}"><button type="button" class="open-asset block w-full text-left" aria-label="Open ${escapeHtml(asset.title)}"><div class="overflow-hidden bg-black/20">${mediaPreview(primary)}</div><div class="p-4"><div class="text-[9px] font-semibold uppercase tracking-[0.13em] text-acid">${escapeHtml(asset.category)}</div><h2 class="mt-2 truncate text-sm font-semibold text-zinc-200">${escapeHtml(asset.title)}</h2><p class="mt-2 line-clamp-2 min-h-9 text-[10px] leading-[18px] text-zinc-600">${escapeHtml(asset.description || primary.original_name)}</p><div class="mt-3 flex flex-wrap gap-1">${asset.tags.map((tag) => `<span class="rounded-full bg-white/[0.035] px-2 py-1 text-[8px] text-zinc-600">${escapeHtml(tag)}</span>`).join("")}</div><div class="mt-4 border-t border-white/[0.06] pt-3 text-[10px] text-zinc-600">${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(files.reduce((total, file) => total + Number(file.size_bytes || 0), 0))} <span class="text-acid">· View files</span></div></div></button>${permissions.canManageLibraries ? `<button type="button" class="delete-asset icon-button absolute right-3 top-3 bg-black/80 text-red-300/70" aria-label="Delete ${escapeHtml(asset.title)}"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>` : ""}</article>`;
}

function assetFilePreview(file) {
  const url = escapeHtml(file.content_url);
  if (file.kind === "image" && !String(file.mime_type).includes("svg")) return `<img src="${url}" alt="${escapeHtml(file.original_name)}" loading="lazy" class="max-h-[460px] w-full bg-black/30 object-contain" />`;
  if (file.kind === "video") return `<video src="${url}" controls preload="metadata" class="max-h-[460px] w-full bg-black"></video>`;
  if (file.kind === "audio") return `<div class="grid min-h-36 place-items-center bg-black/30 p-5"><audio src="${url}" controls preload="metadata" class="w-full"></audio></div>`;
  if (String(file.mime_type).toLowerCase() === "application/pdf") return `<iframe src="${url}" title="${escapeHtml(file.original_name)}" loading="lazy" class="h-[420px] w-full bg-white"></iframe>`;
  return `<div class="grid min-h-36 place-items-center bg-black/30 text-zinc-600"><i data-lucide="file-box" class="h-10 w-10"></i></div>`;
}

function openAssetViewer(asset) {
  if (!assetViewer) return;
  assetViewer.querySelector("#assetViewerCategory").textContent = asset.category;
  assetViewer.querySelector("#assetViewerTitle").textContent = asset.title;
  assetViewer.querySelector("#assetViewerDescription").textContent = asset.description || "";
  assetViewer.querySelector("#assetViewerTags").innerHTML = asset.tags.map((tag) => `<span class="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-zinc-400">${escapeHtml(tag)}</span>`).join("");
  assetViewer.querySelector("#assetViewerFiles").innerHTML = (asset.files?.length ? asset.files : [asset]).map((file) => `<article class="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-black/20">${assetFilePreview(file)}<div class="flex items-center gap-3 p-3"><div class="min-w-0 flex-1"><div class="truncate text-xs font-semibold text-zinc-200" title="${escapeHtml(file.original_name)}">${escapeHtml(file.original_name)}</div><div class="mt-1 text-[10px] text-zinc-600">${formatBytes(file.size_bytes)}</div></div><a href="${escapeHtml(file.download_url)}" class="ghost-button h-8 px-3 text-[10px]">Download</a></div></article>`).join("");
  assetViewer.classList.remove("hidden");
  assetViewer.classList.add("flex");
  requestAnimationFrame(() => assetViewer.querySelector(".modal-card").classList.add("open"));
  assetViewer.querySelector("#closeAssetViewer").focus();
  lucide.createIcons();
}

function closeAssetViewer() {
  if (!assetViewer) return;
  assetViewer.querySelectorAll("video, audio").forEach((media) => media.pause());
  assetViewer.classList.add("hidden");
  assetViewer.classList.remove("flex");
  assetViewer.querySelector(".modal-card").classList.remove("open");
  assetViewer.querySelector("#assetViewerFiles").replaceChildren();
}

function openLibraryMediaViewer(file) {
  if (!libraryMediaViewer || !file || file.kind !== "image" || String(file.mime_type).includes("svg")) return;
  libraryMediaViewer.querySelector("#libraryMediaViewerTitle").textContent = file.original_name;
  libraryMediaViewer.querySelector("#libraryMediaViewerDownload").href = file.download_url;
  const body = libraryMediaViewer.querySelector("#libraryMediaViewerBody");
  body.replaceChildren();
  const image = document.createElement("img");
  image.id = "libraryMediaViewerImage";
  image.src = file.content_url;
  image.alt = file.original_name;
  image.className = "max-h-[calc(95vh-150px)] max-w-full object-contain";
  body.append(image);
  libraryMediaViewer.classList.remove("hidden");
  libraryMediaViewer.classList.add("flex");
  requestAnimationFrame(() => libraryMediaViewer.querySelector(".modal-card")?.classList.add("open"));
  lucide.createIcons();
}

function closeLibraryMediaViewer() {
  libraryMediaViewer?.querySelector(".modal-card")?.classList.remove("open");
  libraryMediaViewer?.querySelector("#libraryMediaViewerBody")?.replaceChildren();
  libraryMediaViewer?.classList.add("hidden");
  libraryMediaViewer?.classList.remove("flex");
}

function filteredItems() {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    const haystack = libraryType === "prompts"
      ? [item.title, item.prompt, item.negative_prompt, item.created_by_name, ...(item.tags || []), ...item.assets.map((asset) => asset.original_name)].join(" ").toLowerCase()
      : [item.title, item.description, item.original_name, item.uploaded_by_name, ...(item.tags || []), ...(item.files || []).map((file) => file.original_name)].join(" ").toLowerCase();
    return (!needle || haystack.includes(needle))
      && (libraryType !== "assets" || category === "all" || item.category === category)
      && (libraryType !== "assets" || kind === "all" || (item.files?.length ? item.files : [item]).some((file) => file.kind === kind));
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
  grid.querySelectorAll("[data-library-media-id]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const file = items.flatMap((item) => libraryType === "prompts" ? item.assets : (item.files?.length ? item.files : [item])).find((candidate) => candidate.id === Number(button.dataset.libraryMediaId));
    openLibraryMediaViewer(file);
  }));
  grid.querySelectorAll(".open-asset").forEach((button) => button.addEventListener("click", () => {
    const asset = items.find((item) => item.id === Number(button.closest("[data-asset-id]").dataset.assetId));
    if (asset) openAssetViewer(asset);
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
    if (!window.confirm(`Delete “${asset.title}” and all its stored files?`)) return;
    const response = await fetch(`/api/library-assets/${id}`, { method: "DELETE" });
    if (!response.ok) return showToast((await response.json()).error || "Could not delete asset");
    items = items.filter((item) => item.id !== id); render(); showToast("Asset deleted");
  }));
}

function openModal() { modal?.classList.remove("hidden"); modal?.classList.add("flex"); requestAnimationFrame(() => modal?.querySelector(".modal-card")?.classList.add("open")); }
function closeModal() {
  modal?.querySelector(".modal-card")?.classList.remove("open");
  if (libraryType === "assets") {
    modal?.querySelector("form")?.reset();
    assetTagValues = [];
    renderSelectedTags();
    renderAssetTagSuggestions();
  }
  setTimeout(() => { modal?.classList.add("hidden"); modal?.classList.remove("flex"); }, 180);
}

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
assetViewer?.addEventListener("click", (event) => { if (event.target === assetViewer) closeAssetViewer(); });
libraryMediaViewer?.addEventListener("click", (event) => { if (event.target === libraryMediaViewer) closeLibraryMediaViewer(); });
document.querySelector("#closeAssetViewer")?.addEventListener("click", closeAssetViewer);
document.querySelector("#libraryMediaViewerClose")?.addEventListener("click", closeLibraryMediaViewer);
document.querySelector("#libraryMediaViewerFullscreen")?.addEventListener("click", async () => {
  const image = document.querySelector("#libraryMediaViewerImage");
  if (!image) return;
  if (document.fullscreenElement) return document.exitFullscreen?.();
  await image.requestFullscreen?.();
});
document.querySelector(".library-mobile-menu")?.addEventListener("click", () => document.querySelector(".app-sidebar").classList.toggle("mobile-open"));
document.querySelector(".library-logout")?.addEventListener("click", async () => { await fetch("/auth/logout", { method: "POST" }); window.location.assign(`${window.__AI_HUB_BASE__ || ""}/login`); });
document.querySelectorAll("[data-planned-feature]").forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.plannedFeature} is planned for a future update`)));

function renderSelectedTags() {
  const selected = document.querySelector("#assetSelectedTags");
  if (!selected) return;
  selected.innerHTML = assetTagValues.map((tag) => `<button type="button" class="asset-selected-tag rounded-full border border-acid/30 bg-acid/10 px-2.5 py-1 text-[10px] text-acid" data-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">${escapeHtml(tag)} ×</button>`).join("");
  selected.querySelectorAll(".asset-selected-tag").forEach((button) => button.addEventListener("click", () => {
    assetTagValues = assetTagValues.filter((tag) => tag !== button.dataset.tag);
    renderSelectedTags();
    renderAssetTagSuggestions();
  }));
  document.querySelector("#assetTagsValue").value = assetTagValues.join(", ");
}

async function addAssetTag(value, { clearInput = true } = {}) {
  const input = document.querySelector("#assetTagsInput");
  const tag = String(value || "").trim().replace(/\s+/g, " ");
  if (!input || !tag) return;
  if (tag.length > 80 || tag.includes(",")) return showToast("Each tag must be under 80 characters without a comma");
  if (assetTagValues.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) { if (clearInput) input.value = ""; return; }
  const response = await fetch("/api/library-asset-tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not save tag");
  assetTagValues.push(payload.tag);
  if (!assetTags.some((item) => item.toLocaleLowerCase() === payload.tag.toLocaleLowerCase())) assetTags.push(payload.tag);
  assetTags.sort((a, b) => a.localeCompare(b));
  if (clearInput && input.value.trim() === tag) input.value = "";
  renderSelectedTags();
  renderAssetTagSuggestions();
}

function queueAssetTag(value, options) {
  pendingTagSave = pendingTagSave.catch(() => {}).then(() => addAssetTag(value, options));
  pendingTagSave.catch((error) => showToast(error.message));
  return pendingTagSave;
}

function renderAssetTagSuggestions() {
  const suggestions = document.querySelector("#assetTagSuggestions");
  if (!suggestions) return;
  const needle = document.querySelector("#assetTagsInput").value.trim().toLocaleLowerCase();
  suggestions.innerHTML = assetTags.filter((tag) => !assetTagValues.some((selected) => selected.toLocaleLowerCase() === tag.toLocaleLowerCase()) && (!needle || tag.toLocaleLowerCase().includes(needle))).slice(0, 12).map((tag) => `<button type="button" class="asset-tag-suggestion rounded-full border border-white/[0.08] px-2 py-1 text-[9px] text-zinc-500 transition hover:border-acid/40 hover:text-acid" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("");
  suggestions.querySelectorAll(".asset-tag-suggestion").forEach((button) => button.addEventListener("click", () => { void queueAssetTag(button.dataset.tag); }));
}

renderAssetTagSuggestions();
document.querySelector("#assetTagsInput")?.addEventListener("input", (event) => {
  if (event.target.value.includes(",")) {
    const parts = event.target.value.split(",");
    event.target.value = parts.pop();
    parts.forEach((part) => { if (part.trim()) void queueAssetTag(part, { clearInput: false }); });
  }
  renderAssetTagSuggestions();
});
document.querySelector("#assetTagsInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); void queueAssetTag(event.target.value); }
});

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
      const pendingTag = form.querySelector("#assetTagsInput").value.trim();
      if (pendingTag) await queueAssetTag(pendingTag);
      else await pendingTagSave;
      const data = new FormData(form);
      const files = [...form.elements.files.files];
      if (!files.length) throw new Error("Choose at least one file to upload");
      const oversized = files.find((file) => maxUploadBytes && file.size > maxUploadBytes);
      if (oversized) throw new Error(`${oversized.name} exceeds the upload limit`);
      const response = await fetch("/api/library-assets", { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not upload asset");
      items.unshift(payload);
      assetTags = [...new Set([...assetTags, ...(payload.tags || [])])].sort((a, b) => a.localeCompare(b));
      renderAssetTagSuggestions();
      render(); showToast(`${payload.files?.length || 1} file${payload.files?.length === 1 ? "" : "s"} uploaded`);
    }
    form.reset(); assetTagValues = []; renderSelectedTags(); renderAssetTagSuggestions(); closeModal();
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});

document.addEventListener("keydown", (event) => { if (event.key === "Escape") { if (libraryMediaViewer?.classList.contains("flex")) closeLibraryMediaViewer(); else if (assetViewer?.classList.contains("flex")) closeAssetViewer(); else if (modal?.classList.contains("flex")) closeModal(); } });
render();
