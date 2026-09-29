/* global lucide */

const plan = window.__AI_HUB_PLAN__;
const permissions = window.__AI_HUB_PERMISSIONS__;
const resourceRoles = window.__AI_HUB_RESOURCE_ROLES__ || [];
const generationCatalogs = window.__AI_HUB_GENERATION_CATALOGS__ || { models: [], platforms: [], resource_roles: [] };
const maxUploadBytes = Number(window.__AI_HUB_MAX_UPLOAD_BYTES__);
const appPath = (path) => `${window.__AI_HUB_BASE__ || ""}${path}`;
const toast = document.querySelector("#shotToast");
let activeGenerationId = null;
let editorResourceLinks = new Map();
let editorOriginalPlatformId = null;
let editorOriginalTokenPrice = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  toast.querySelector("span").textContent = message;
  toast.classList.remove("translate-y-4", "opacity-0");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("translate-y-4", "opacity-0"), 2400);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatCost(value) {
  const cost = Number(value || 0);
  if (!cost) return "Not tracked";
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value || "Unknown date");
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function activateTab(name, { scroll = true } = {}) {
  document.querySelectorAll(".shot-tab").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.classList.toggle("text-zinc-600", !active);
  });
  document.querySelectorAll(".shot-panel").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== name));
  window.history.replaceState(null, "", `#${name}`);
  if (scroll) {
    const tab = document.querySelector(".shot-tab");
    const navigationHeight = document.querySelector("#shotNavigationForm")?.getBoundingClientRect().height || 0;
    window.scrollTo({ top: tab.getBoundingClientRect().top + window.scrollY - navigationHeight - 80, behavior: "smooth" });
  }
  lucide.createIcons();
}

document.querySelectorAll(".shot-tab").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
document.querySelectorAll("[data-open-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.openTab)));

async function updateStatus(status) {
  const response = await fetch(`/api/plans/${plan.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  const payload = await response.json();
  if (!response.ok) return showToast(payload.error || "Could not update this shot");
  showToast(`Shot moved to ${status}`);
  setTimeout(() => window.location.reload(), 450);
}

async function approveShot() {
  const response = await fetch(`/api/plans/${plan.id}/approval`, { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(payload.error || "Could not approve this shot");
  showToast("Selected generation approved");
  setTimeout(() => window.location.reload(), 450);
}

document.querySelector("#shotStatusSelect")?.addEventListener("change", (event) => updateStatus(event.target.value));
document.querySelector("#approveShotButton")?.addEventListener("click", approveShot);
document.querySelector("#copyPromptButton")?.addEventListener("click", async () => {
  await navigator.clipboard.writeText(plan.prompt || "");
  showToast("Prompt copied");
});

const accountButton = document.querySelector("#shotAccountButton");
const accountMenu = document.querySelector("#shotAccountMenu");
accountButton?.addEventListener("click", (event) => { event.stopPropagation(); accountMenu.classList.toggle("hidden"); });
document.addEventListener("click", (event) => {
  if (accountMenu && !accountMenu.contains(event.target) && !accountButton.contains(event.target)) accountMenu.classList.add("hidden");
});
document.querySelector("#shotLogoutButton")?.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  window.location.assign(`${window.__AI_HUB_BASE__ || ""}/login`);
});
document.querySelector("#deleteShotButton")?.addEventListener("click", async () => {
  if (!window.confirm(`Delete #Seq ${plan.sequence_number} / #Shot ${plan.shot_number}, including all generations and files? This cannot be undone.`)) return;
  const response = await fetch(`/api/plans/${plan.id}`, { method: "DELETE" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return showToast(payload.error || "Could not delete shot");
  }
  window.location.assign(window.__AI_HUB_BASE__ ? window.__AI_HUB_BASE__ + "/" : "/");
});

function openModal(modal) {
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  document.body.classList.add("overflow-hidden");
  requestAnimationFrame(() => modal.querySelector(".modal-card")?.classList.add("open"));
}

function closeModal(modal) {
  modal.querySelector(".modal-card")?.classList.remove("open");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    if (!document.querySelector(".modal-backdrop.flex")) document.body.classList.remove("overflow-hidden");
  }, 180);
}

const generationModal = document.querySelector("#generationModal");
const generationEditorModal = document.querySelector("#generationEditorModal");

function generationById(id) {
  return plan.generations.find((generation) => generation.id === Number(id));
}

function mediaPreview(resource, { compact = false } = {}) {
  if (!resource) {
    return `<div class="media-frame relative ${compact ? "aspect-video" : "min-h-[320px] h-full"}" style="--image-position:${escapeHtml(plan.image_position)}"><div class="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/20"></div><div class="absolute inset-x-0 bottom-0 p-5 text-xs text-white/50">No output file linked to this generation.</div></div>`;
  }
  const url = escapeHtml(resource.content_url);
  const name = escapeHtml(resource.original_name);
  if (resource.kind === "image" && !String(resource.mime_type).includes("svg")) return `<img src="${url}" alt="${name}" class="h-full w-full object-contain" />`;
  if (resource.kind === "video") return `<video src="${url}" controls preload="metadata" class="h-full w-full bg-black object-contain"></video>`;
  if (resource.kind === "audio") return `<div class="flex h-full min-h-[280px] flex-col items-center justify-center p-8"><span class="grid h-20 w-20 place-items-center rounded-3xl bg-acid/10 text-acid"><i data-lucide="audio-lines" class="h-9 w-9"></i></span><audio src="${url}" controls preload="metadata" class="mt-7 w-full max-w-lg"></audio></div>`;
  return `<a href="${escapeHtml(resource.download_url)}" class="flex h-full min-h-[280px] flex-col items-center justify-center text-zinc-500"><i data-lucide="file-down" class="h-9 w-9"></i><span class="mt-3 text-xs">Download ${name}</span></a>`;
}

function generationResourceCard(resource) {
  const preview = resource.kind === "image" && !String(resource.mime_type).includes("svg")
    ? `<img src="${escapeHtml(resource.content_url)}" alt="" loading="lazy" class="h-full w-full object-cover" />`
    : resource.kind === "video"
      ? `<video src="${escapeHtml(resource.content_url)}" muted preload="metadata" class="h-full w-full object-cover"></video>`
      : `<div class="grid h-full place-items-center text-zinc-700"><i data-lucide="${resource.kind === "audio" ? "audio-lines" : "file-box"}" class="h-6 w-6"></i></div>`;
  return `<a href="${escapeHtml(resource.content_url)}" target="_blank" rel="noopener" class="group overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] transition hover:border-white/15">
    <div class="relative aspect-video overflow-hidden bg-black/25">${preview}<span class="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[8px] font-semibold text-acid backdrop-blur">${escapeHtml(resource.role)}</span></div>
    <div class="p-3"><div class="truncate text-[11px] font-semibold text-zinc-300">${escapeHtml(resource.original_name)}</div><div class="mt-1 text-[9px] text-zinc-700">${formatBytes(resource.size_bytes)}${resource.generation_usage_count > 1 ? ` · reused in ${resource.generation_usage_count} versions` : ""}</div></div>
  </a>`;
}

function openGenerationDetail(id) {
  const generation = generationById(id);
  if (!generation) return;
  activeGenerationId = generation.id;
  const output = generation.resources.find((resource) => resource.role === "Output");
  const inputs = generation.resources.filter((resource) => resource.role !== "Output");
  const isApproved = generation.status === "Approved";
  document.querySelector("#generationModalTitle").innerHTML = `${escapeHtml(generation.version_label)} <span class="status-pill ml-2 ${isApproved ? 'border-lime-400/25 bg-lime-400/10 text-lime-300' : 'border-amber-400/25 bg-amber-400/10 text-amber-300'}">${escapeHtml(generation.status || 'WIP')}</span>`;
  document.querySelector("#generationDetailBody").innerHTML = `
    <div class="grid min-h-[420px] lg:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)]">
      <div class="min-h-[320px] overflow-hidden bg-black/40">${mediaPreview(output)}</div>
      <aside class="border-t border-white/[0.07] p-5 lg:border-l lg:border-t-0 sm:p-6">
        <div class="mb-4 text-sm font-semibold text-acid">#Seq ${generation.sequence_number} / #Shot ${generation.shot_number}</div>
        <div><span class="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[9px] font-semibold text-zinc-400">${escapeHtml(generation.platform_name || "Platform not recorded")}</span><h3 class="mt-4 text-3xl font-semibold tracking-tight">${escapeHtml(generation.version_label)}</h3><div class="mt-2 text-xs text-zinc-500">${escapeHtml(generation.model)}</div><div class="mt-1 text-[10px] text-zinc-700">${escapeHtml(formatDate(generation.created_at))}</div></div>
        <dl class="mt-6 grid grid-cols-2 gap-2 text-[10px]"><div class="rounded-xl bg-white/[0.025] p-3"><dt class="text-zinc-700">Generated by</dt><dd class="mt-1.5 font-medium text-zinc-300">${escapeHtml(generation.created_by_name || "Unknown")}</dd></div><div class="rounded-xl bg-white/[0.025] p-3"><dt class="text-zinc-700">Seed</dt><dd class="mt-1.5 truncate font-medium text-zinc-300">${escapeHtml(generation.seed || "Not recorded")}</dd></div><div class="rounded-xl bg-white/[0.025] p-3"><dt class="text-zinc-700">Tokens / credits</dt><dd class="mt-1.5 font-medium text-zinc-300">${Number(generation.token_count || generation.total_tokens || 0).toLocaleString()}</dd></div><div class="rounded-xl bg-white/[0.025] p-3"><dt class="text-zinc-700">Price snapshot</dt><dd class="mt-1.5 font-medium text-zinc-300">${generation.platform_name ? `$${Number(generation.token_price_snapshot || 0).toFixed(6)} / token` : "Legacy calculation"}</dd></div></dl>
        <div class="mt-5 rounded-2xl border border-white/[0.07] bg-black/20 p-4"><div class="flex items-center justify-between"><span class="text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-600">Estimated generation cost</span><strong class="text-sm text-acid">${formatCost(generation.generation_cost)}</strong></div><div class="mt-3 text-[10px] leading-5 text-zinc-600">${generation.platform_name ? `${Number(generation.token_count || 0).toLocaleString()} tokens × $${Number(generation.token_price_snapshot || 0).toFixed(6)}` : "This older generation uses its original legacy cost calculation."}</div></div>
      </aside>
    </div>
    <div class="border-t border-white/[0.07] p-5 sm:p-6">
      <div class="grid gap-5 lg:grid-cols-2"><section><div class="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Prompt</div><div class="mt-3 whitespace-pre-wrap rounded-2xl border border-white/[0.06] bg-black/20 p-4 text-xs leading-6 text-zinc-300">${escapeHtml(generation.prompt || "No prompt recorded.")}</div>${generation.negative_prompt ? `<div class="mt-4 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Negative prompt</div><div class="mt-3 whitespace-pre-wrap rounded-2xl border border-white/[0.06] bg-black/15 p-4 text-[11px] leading-5 text-zinc-500">${escapeHtml(generation.negative_prompt)}</div>` : ""}</section><section><div class="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Notes</div><div class="mt-3 whitespace-pre-wrap rounded-2xl border border-white/[0.06] bg-black/20 p-4 text-xs leading-6 text-zinc-400">${escapeHtml(generation.notes || "No notes recorded.")}</div></section></div>
      ${inputs.length ? `<section class="mt-6"><div class="flex items-center justify-between"><div><div class="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Generation resources</div><div class="mt-1 text-[11px] text-zinc-700">Only inputs linked to this version are shown.</div></div><span class="rounded-full border border-white/[0.08] px-2.5 py-1 text-[9px] text-zinc-600">${inputs.length} linked</span></div><div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${inputs.map(generationResourceCard).join("")}</div></section>` : `<div class="mt-6 rounded-2xl border border-dashed border-white/10 py-10 text-center text-xs text-zinc-700">No optional input resources are linked to this generation.</div>`}
    </div>`;

  const selectButton = document.querySelector("#selectGenerationButton");
  const editButton = document.querySelector("#editGenerationButton");
  const approveGenButton = document.querySelector("#approveGenerationButton");
  selectButton?.classList.toggle("hidden", !permissions.canSetCurrentFinal || generation.id === plan.selected_generation_id);
  editButton.classList.toggle("hidden", !permissions.canEditPlans);
  if (approveGenButton) {
    approveGenButton.classList.toggle("hidden", !permissions.canApprovePlans);
    const textEl = document.querySelector("#approveGenerationButtonText");
    if (textEl) textEl.textContent = isApproved ? "Mark as WIP" : "Approve generation";
    approveGenButton.className = `${isApproved ? "ghost-button text-amber-300/90 hover:text-amber-200" : "primary-button"} h-10 px-4 text-xs`;
    const icon = approveGenButton.querySelector("i");
    if (icon) icon.setAttribute("data-lucide", isApproved ? "clock" : "circle-check");
  }
  openModal(generationModal);
  lucide.createIcons();
}

document.querySelectorAll(".generation-open-button").forEach((button) => button.addEventListener("click", () => openGenerationDetail(button.dataset.generationId)));

async function selectGeneration(id) {
  const response = await fetch(`/api/plans/${plan.id}/selected-generation`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generation_id: Number(id) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(payload.error || "Could not select this generation");
  showToast("Current final version updated");
  setTimeout(() => window.location.reload(), 500);
}

async function toggleGenerationStatus(id, targetStatus) {
  const response = await fetch(`/api/generations/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: targetStatus })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(payload.error || "Could not update generation status");
  showToast(targetStatus === "Approved" ? "Generation approved" : "Generation marked as WIP");
  setTimeout(() => window.location.reload(), 450);
}

document.querySelector("#approveGenerationButton")?.addEventListener("click", () => {
  const generation = generationById(activeGenerationId);
  if (!generation) return;
  const nextStatus = generation.status === "Approved" ? "WIP" : "Approved";
  toggleGenerationStatus(generation.id, nextStatus);
});

document.querySelectorAll(".toggle-generation-status-button").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const id = Number(button.dataset.generationId);
    const status = button.dataset.status;
    toggleGenerationStatus(id, status);
  });
});

document.querySelectorAll(".select-generation-button").forEach((button) => button.addEventListener("click", () => selectGeneration(button.dataset.generationId)));
document.querySelector("#selectGenerationButton")?.addEventListener("click", () => selectGeneration(activeGenerationId));
document.querySelector("#deleteGenerationButton")?.addEventListener("click", async () => {
  const generation = generationById(activeGenerationId);
  if (!generation || !window.confirm(`Delete ${generation.version_label}? Linked files will remain in the plan's Assets tab.`)) return;
  const response = await fetch(`/api/generations/${generation.id}`, { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(payload.error || "Could not delete generation");
  showToast("Generation deleted");
  setTimeout(() => window.location.reload(), 400);
});
document.querySelectorAll(".generation-modal-close").forEach((button) => button.addEventListener("click", () => closeModal(generationModal)));
generationModal?.addEventListener("click", (event) => { if (event.target === generationModal) closeModal(generationModal); });

const editorFields = {
  sequence_number: document.querySelector("#generationSequenceNumberInput"),
  shot_number: document.querySelector("#generationShotNumberInput"),
  id: document.querySelector("#generationIdInput"),
  version_number: document.querySelector("#generationVersionNumberInput"),
  status: document.querySelector("#generationStatusInput"),
  model: document.querySelector("#generationModelInput"),
  prompt: document.querySelector("#generationPromptInput"),
  negative_prompt: document.querySelector("#generationNegativePromptInput"),
  notes: document.querySelector("#generationNotesInput"),
  seed: document.querySelector("#generationSeedInput"),
  platform_id: document.querySelector("#generationPlatformInput"),
  token_count: document.querySelector("#generationTokenCountInput")
};

function defaultResourceRole() {
  return resourceRoles.includes("Other Input") ? "Other Input" : resourceRoles[0];
}

function renderModelOptions(selectedModel) {
  const models = generationCatalogs.models || [];
  const options = models.map((model) => `<option value="${escapeHtml(model.name)}">${escapeHtml(model.name)}</option>`);
  if (selectedModel && !models.some((model) => model.name === selectedModel)) options.unshift(`<option value="${escapeHtml(selectedModel)}">${escapeHtml(selectedModel)} (historical)</option>`);
  editorFields.model.innerHTML = options.join("");
  editorFields.model.value = selectedModel || models[0]?.name || "";
}

function renderPlatformOptions(generation) {
  const platforms = generationCatalogs.platforms || [];
  const options = platforms.map((platform) => `<option value="${platform.id}">${escapeHtml(platform.name)}</option>`);
  const historicalId = Number(generation?.platform_id || 0);
  if (historicalId && !platforms.some((platform) => platform.id === historicalId)) options.unshift(`<option value="${historicalId}">${escapeHtml(generation.platform_name || "Historical platform")} (historical)</option>`);
  editorFields.platform_id.innerHTML = options.join("");
  editorFields.platform_id.value = String(historicalId || platforms[0]?.id || "");
}

function renderSelectedOutput() {
  const target = document.querySelector("#generationSelectedOutput");
  const outputId = [...editorResourceLinks.entries()].find(([, role]) => role === "Output")?.[0];
  const resource = plan.resources.find((item) => item.id === outputId);
  target.classList.toggle("hidden", !resource);
  if (!resource) {
    target.replaceChildren();
    return;
  }
  const icon = resource.kind === "image" ? "image" : resource.kind === "video" ? "file-video-2" : resource.kind === "audio" ? "audio-lines" : "file-check-2";
  const preview = resource.kind === "image" && !String(resource.mime_type).includes("svg")
    ? `<img src="${escapeHtml(resource.content_url)}" alt="" class="h-full w-full object-cover" />`
    : `<i data-lucide="${icon}" class="h-5 w-5"></i>`;
  target.innerHTML = `<div class="flex min-w-0 items-center gap-3 rounded-2xl border border-acid/20 bg-acid/[0.045] p-3"><span class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-black/30 text-acid">${preview}</span><span class="min-w-0 flex-1"><span class="block truncate text-xs font-semibold text-zinc-100" title="${escapeHtml(resource.original_name)}">${escapeHtml(resource.original_name)}</span><span class="mt-1 block text-[10px] text-zinc-500">${formatBytes(resource.size_bytes)} · ${escapeHtml(resource.kind)} output</span></span><span class="rounded-full border border-acid/20 bg-acid/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-acid">Selected</span></div>`;
  lucide.createIcons();
}

function updateCostPreview() {
  const selectedPlatformId = Number(editorFields.platform_id.value || 0);
  const selectedPlatform = (generationCatalogs.platforms || []).find((platform) => platform.id === selectedPlatformId);
  const preservesSnapshot = Boolean(editorFields.id.value) && selectedPlatformId === editorOriginalPlatformId;
  const price = preservesSnapshot ? editorOriginalTokenPrice : Number(selectedPlatform?.token_price || 0);
  const cost = Number(editorFields.token_count.value || 0) * price;
  document.querySelector("#generationCostPreview").textContent = cost ? formatCost(cost) : "$0.0000";
  document.querySelector("#generationTokenPricePreview").textContent = `$${price.toFixed(6)} / token`;
  document.querySelector("#generationPriceNote").textContent = preservesSnapshot
    ? "Saved price snapshot — unchanged by later Admin edits"
    : "Current Admin price — it will be frozen when saved";
}

editorFields.token_count.addEventListener("input", updateCostPreview);
editorFields.platform_id.addEventListener("change", updateCostPreview);

function fillEditor(generation = null) {
  const nextVersion = Math.max(0, ...plan.generations.map((item) => Number(item.version_number || 0))) + 1;
  const planModel = (generationCatalogs.models || []).some((model) => model.name === plan.model) ? plan.model : generationCatalogs.models?.[0]?.name || "";
  editorFields.id.value = generation?.id || "";
  for (const key of ["sequence_number", "shot_number"]) {
    editorFields[key].value = generation?.[key] ?? plan[key];
    editorFields[key].readOnly = Boolean(generation);
  }
  editorFields.version_number.value = generation?.version_number || nextVersion;
  if (editorFields.status) editorFields.status.value = generation?.status || "WIP";
  renderModelOptions(generation?.model || planModel);
  renderPlatformOptions(generation);
  editorFields.prompt.value = generation?.prompt || plan.prompt || "";
  editorFields.negative_prompt.value = generation?.negative_prompt || plan.negative_prompt || "";
  editorFields.notes.value = generation?.notes || "";
  editorFields.seed.value = generation?.seed || "";
  editorFields.token_count.value = generation?.token_count || 0;
  editorOriginalPlatformId = Number(generation?.platform_id || 0);
  editorOriginalTokenPrice = Number(generation?.token_price_snapshot || 0);
  editorResourceLinks = new Map((generation?.resources || []).map((resource) => [resource.id, resource.role]));
  document.querySelector("#generationEditorTitle").textContent = generation ? `Edit ${generation.version_label}` : "Add generation";
  document.querySelector("#generationUploadStatus").textContent = generation?.resources.some((resource) => resource.role === "Output")
    ? "Drop a new file to replace this output, then save the generation."
    : "Your uploaded file will be linked when you save the generation.";
  renderSelectedOutput();
  updateCostPreview();
}

function openGenerationEditor(generation = null) {
  if (generationModal.classList.contains("flex")) closeModal(generationModal);
  fillEditor(generation);
  setTimeout(() => {
    openModal(generationEditorModal);
    editorFields.version_number.focus();
    lucide.createIcons();
  }, generation ? 180 : 0);
}

document.querySelector("#addGenerationButton")?.addEventListener("click", () => openGenerationEditor());
document.querySelector(".generation-empty-add")?.addEventListener("click", () => openGenerationEditor());
document.querySelector("#editGenerationButton")?.addEventListener("click", () => openGenerationEditor(generationById(activeGenerationId)));
document.querySelectorAll(".generation-editor-close").forEach((button) => button.addEventListener("click", () => closeModal(generationEditorModal)));
generationEditorModal?.addEventListener("click", (event) => { if (event.target === generationEditorModal) closeModal(generationEditorModal); });
document.querySelector("#generationOutputDropZone")?.addEventListener("keydown", (event) => {
  if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    document.querySelector("#generationUploadInput")?.click();
  }
});

function generationPayload() {
  return {
    sequence_number: Number(editorFields.sequence_number.value),
    shot_number: Number(editorFields.shot_number.value),
    version_number: Number(editorFields.version_number.value),
    status: editorFields.status?.value || "WIP",
    model: editorFields.model.value,
    prompt: editorFields.prompt.value.trim(),
    negative_prompt: editorFields.negative_prompt.value.trim(),
    notes: editorFields.notes.value.trim(),
    seed: editorFields.seed.value.trim(),
    platform_id: Number(editorFields.platform_id.value),
    token_count: Number(editorFields.token_count.value || 0),
    resources: [...editorResourceLinks.entries()].map(([resourceId, role]) => ({ resource_id: resourceId, role }))
  };
}

document.querySelector("#generationEditorForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validGenerationNumbers()) return;
  const generationId = Number(editorFields.id.value || 0);
  const saveButton = document.querySelector("#saveGenerationButton");
  saveButton.disabled = true;
  saveButton.querySelector("span")?.remove();
  const response = await fetch(generationId ? `/api/generations/${generationId}` : `/api/plans/${plan.id}/generations`, {
    method: generationId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(generationPayload())
  });
  const payload = await response.json().catch(() => ({}));
  saveButton.disabled = false;
  if (!response.ok) return showToast(payload.error || "Could not save this generation");
  showToast(generationId ? "Generation updated" : "Generation added");
  window.location.hash = "generations";
  setTimeout(() => window.location.reload(), 550);
});

function validGenerationNumbers() {
  if (!document.querySelector("#generationEditorForm").reportValidity()) return false;
  if (Number(editorFields.sequence_number.value) !== plan.sequence_number || Number(editorFields.shot_number.value) !== plan.shot_number) {
    showToast(`Use this shot's locked numbers: #Seq ${plan.sequence_number} / #Shot ${plan.shot_number}`);
    return false;
  }
  return true;
}

function uploadResource(file, category, notes, onProgress = () => {}, numbers = plan, assetRole = defaultResourceRole()) {
  return new Promise((resolve, reject) => {
    const payload = new FormData();
    payload.append("sequence_number", numbers.sequence_number);
    payload.append("shot_number", numbers.shot_number);
    payload.append("category", category);
    payload.append("asset_role", assetRole);
    payload.append("notes", notes);
    payload.append("file", file, file.name);
    const request = new XMLHttpRequest();
    request.open("POST", appPath(`/api/plans/${plan.id}/resources`));
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => request.status >= 200 && request.status < 300 ? resolve(request.response) : reject(new Error(request.response?.error || "Upload failed")));
    request.addEventListener("error", () => reject(new Error("The connection was interrupted")));
    request.send(payload);
  });
}

const generationUploadInput = document.querySelector("#generationUploadInput");
generationUploadInput?.addEventListener("change", async () => {
  const files = [...generationUploadInput.files];
  generationUploadInput.value = "";
  if (!files.length) return;
  if (!validGenerationNumbers()) return;
  const oversized = files.find((file) => file.size > maxUploadBytes);
  if (oversized) return showToast(`${oversized.name} is larger than ${formatBytes(maxUploadBytes)}`);
  const status = document.querySelector("#generationUploadStatus");
  let uploaded = 0;
  for (const file of files) {
    try {
      const versionLabel = editorFields.version_number.value ? `v${editorFields.version_number.value}` : "a generation";
      const resource = await uploadResource(file, "Generation", `Uploaded for ${versionLabel}`, (percentage) => { status.textContent = `Uploading ${file.name}: ${percentage}%`; }, plan, "Output");
      resource.generation_usage_count = 0;
      plan.resources.unshift(resource);
      for (const [otherId, otherRole] of editorResourceLinks.entries()) if (otherRole === "Output") editorResourceLinks.delete(otherId);
      editorResourceLinks.set(resource.id, "Output");
      renderSelectedOutput();
      uploaded += 1;
    } catch (error) {
      showToast(error.message);
    }
  }
  status.textContent = uploaded ? "Output uploaded. Save the generation to link it to this version." : "No file was uploaded.";
});

const resourceUploadForm = document.querySelector("#resourceUploadForm");
const resourceDropZone = document.querySelector("#resourceDropZone");
const resourceFileInput = document.querySelector("#resourceFileInput");
const resourceUploadQueue = document.querySelector("#resourceUploadQueue");

document.querySelector("#assetBriefForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!permissions.canEditPlans) return;
  const button = event.currentTarget.querySelector("button[type='submit']");
  const description = document.querySelector("#assetBriefNotes").value.trim();
  button.disabled = true;
  const response = await fetch(`/api/plans/${plan.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description })
  });
  const payload = await response.json().catch(() => ({}));
  button.disabled = false;
  if (!response.ok) return showToast(payload.error || "Could not save the brief and notes");
  plan.description = description;
  showToast("Brief and notes saved");
});

function uploadQueueRow(file) {
  const row = document.createElement("div");
  row.className = "rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5";
  row.innerHTML = `<div class="flex items-center justify-between gap-3 text-[10px]"><span class="min-w-0 truncate font-medium text-zinc-400"></span><span data-upload-label class="shrink-0 text-zinc-600">${formatBytes(file.size)}</span></div><div class="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"><div data-upload-progress class="h-full w-0 rounded-full bg-acid transition-[width]"></div></div>`;
  row.querySelector("span").textContent = file.name;
  return row;
}

async function uploadShotLibraryFiles(fileList) {
  const files = [...fileList];
  if (!files.length || !resourceUploadForm) return;
  const oversized = files.find((file) => file.size > maxUploadBytes);
  if (oversized) return showToast(`${oversized.name} is larger than ${formatBytes(maxUploadBytes)}`);
  resourceUploadQueue.replaceChildren();
  resourceUploadQueue.classList.remove("hidden");
  const assetRole = document.querySelector("#assetResourceRole").value;
  let uploaded = 0;
  for (const file of files) {
    const row = uploadQueueRow(file);
    const label = row.querySelector("[data-upload-label]");
    const bar = row.querySelector("[data-upload-progress]");
    resourceUploadQueue.append(row);
    try {
      await uploadResource(file, "Reference", "", (percentage) => { bar.style.width = `${percentage}%`; label.textContent = percentage === 100 ? "Processing…" : `${percentage}%`; }, plan, assetRole);
      bar.style.width = "100%";
      label.textContent = "Saved";
      label.classList.add("text-acid");
      uploaded += 1;
    } catch (error) {
      label.textContent = error.message;
      label.classList.add("text-red-300");
      bar.classList.replace("bg-acid", "bg-red-400");
    }
  }
  if (uploaded) {
    showToast(`${uploaded} asset${uploaded === 1 ? "" : "s"} added to this plan`);
    window.location.hash = "assets";
    setTimeout(() => window.location.reload(), 650);
  } else showToast("No files were uploaded");
}

resourceUploadForm?.addEventListener("submit", (event) => event.preventDefault());
resourceDropZone?.addEventListener("click", (event) => { if (event.target !== resourceFileInput) resourceFileInput.click(); });
resourceDropZone?.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); resourceFileInput.click(); } });
resourceFileInput?.addEventListener("change", () => { uploadShotLibraryFiles(resourceFileInput.files); resourceFileInput.value = ""; });

document.querySelector("#resourceFilter")?.addEventListener("change", (event) => {
  document.querySelectorAll("[data-resource-card]").forEach((card) => card.classList.toggle("hidden", event.target.value !== "all" && card.dataset.resourceRole !== event.target.value));
});
document.querySelectorAll(".resource-delete-button").forEach((button) => button.addEventListener("click", async () => {
  if (!window.confirm(`Remove ${button.dataset.resourceName} from this shot? It will also be unlinked from every generation that uses it.`)) return;
  button.disabled = true;
  const response = await fetch(`/api/resources/${button.dataset.resourceId}`, { method: "DELETE" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    button.disabled = false;
    return showToast(payload.error || "Could not remove this file");
  }
  showToast("Asset removed from this plan");
  window.location.hash = "assets";
  setTimeout(() => window.location.reload(), 450);
}));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (generationEditorModal?.classList.contains("flex")) closeModal(generationEditorModal);
  else if (generationModal?.classList.contains("flex")) closeModal(generationModal);
});

const initialTab = window.location.hash.slice(1);
activateTab(["generations", "assets"].includes(initialTab) ? initialTab : "generations", { scroll: false });
lucide.createIcons();
