/* global lucide */

const state = {
  plans: window.__AI_HUB_PLANS__ || [],
  currentUser: window.__AI_HUB_CURRENT_USER__ || null,
  permissions: window.__AI_HUB_PERMISSIONS__ || {},
  roleDefinitions: window.__AI_HUB_ROLES__ || {},
  workspaceRoles: window.__AI_HUB_WORKSPACE_ROLES__ || [],
  generationCatalogs: window.__AI_HUB_GENERATION_CATALOGS__ || { models: [], platforms: [], resource_roles: [] },
  query: "",
  status: "all",
  assignment: "all",
  planCardSize: Number(window.localStorage.getItem("ai-hub-plan-card-size") || 0)
};

const els = {
  grid: document.querySelector("#planGrid"),
  count: document.querySelector("#shotResultCount"),
  empty: document.querySelector("#emptyState"),
  search: document.querySelector("#searchInput"),
  filter: document.querySelector("#statusFilter"),
  assignmentFilter: document.querySelector("#assignmentFilter"),
  cardSizeRange: document.querySelector("#planCardSizeRange"),
  cardSizeLabel: document.querySelector("#planCardSizeLabel"),
  modal: document.querySelector("#newPlanModal"),
  modalCard: document.querySelector("#modalCard"),
  form: document.querySelector("#newPlanForm"),
  testPlan: document.querySelector("#isTestPlanInput"),
  numberedPlanFields: document.querySelector("#numberedPlanFields"),
  toast: document.querySelector("#toast")
};

const planCardSizes = [
  { label: "Compact", minWidth: 210 },
  { label: "Comfortable", minWidth: 270 },
  { label: "Large", minWidth: 340 }
];

function applyPlanCardSize() {
  const index = Math.min(Math.max(Number(state.planCardSize) || 0, 0), planCardSizes.length - 1);
  const size = planCardSizes[index];
  state.planCardSize = index;
  els.grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size.minWidth}px, 1fr))`;
  if (els.cardSizeRange) els.cardSizeRange.value = String(index);
  if (els.cardSizeLabel) els.cardSizeLabel.textContent = size.label;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function statusClass(status) {
  const classes = {
    "WIP": "border-amber-400/20 bg-amber-400/10 text-amber-300",
    "Approved": "border-lime-400/20 bg-lime-400/10 text-lime-300"
  };
  return classes[status] || classes.WIP;
}


function filteredPlans() {
  const query = state.query.toLowerCase().trim();
  return state.plans.filter((plan) => {
    const matchesStatus = state.status === "all" || plan.status === state.status;
    const matchesAssignment = state.assignment === "all"
      || (state.assignment === "mine" && (plan.assignees || []).some((user) => user.id === state.currentUser?.id))
      || (state.assignment === "unassigned" && !(plan.assignees || []).length)
      || (state.assignment.startsWith("user:") && (plan.assignees || []).some((user) => user.id === Number(state.assignment.slice(5))));
    const haystack = [plan.title, plan.shot_code, plan.model, plan.owner, ...(plan.tags || [])].join(" ").toLowerCase();
    return window.shotNavigation.matches(plan) && matchesStatus && matchesAssignment && (!query || haystack.includes(query));
  }).sort((a, b) => b.sort_at.localeCompare(a.sort_at) || b.id - a.id);
}

function generationDate(value) {
  const date = new Date(value.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function planCoverMarkup(plan) {
  if (plan.cover_url && plan.cover_kind === "image") {
    return `<img src="${escapeHtml(plan.cover_url)}" alt="" loading="lazy" class="h-full w-full object-cover" />`;
  }
  if (plan.cover_url && plan.cover_kind === "video") {
    return `<video data-plan-cover-video src="${escapeHtml(plan.cover_url)}" muted playsinline preload="auto" class="pointer-events-none h-full w-full object-cover"></video>`;
  }
  return `<div class="grid h-full place-items-center bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.045),transparent_45%)] text-center">
    <div class="text-zinc-700">
      <svg viewBox="0 0 64 64" aria-hidden="true" class="mx-auto h-12 w-12" fill="none"><rect x="9" y="13" width="46" height="38" rx="7" stroke="currentColor" stroke-width="2"/><path d="m15 44 11-12 8 8 6-7 9 11M23 25h.01M12 10l40 44" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="mt-2 text-[10px] font-semibold uppercase tracking-[0.2em]">No media</div>
    </div>
  </div>`;
}

function shotCard(plan) {
  const query = window.shotNavigation.query();
  return `
    <article class="plan-card group relative" data-plan-id="${plan.id}">
      <a href="${window.__AI_HUB_BASE__ || ""}/plans/${plan.id}${query ? `?${query}` : ""}" class="block">
      <div class="relative aspect-video overflow-hidden bg-[#0d0f12]">
        ${planCoverMarkup(plan)}
        <span class="status-pill absolute left-3 top-3 ${statusClass(plan.status)} backdrop-blur-xl">${escapeHtml(plan.status)}</span>
        ${plan.issue ? `<div class="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 p-2 text-xs text-orange-200">${escapeHtml(plan.issue)}</div>` : ""}
      </div>
      <div class="p-4">
        <div class="flex flex-wrap gap-2 text-sm font-semibold text-acid">${plan.is_test_plan ? "Test plan" : `<span>#Seq ${plan.sequence_number}</span><span class="text-zinc-600">/</span><span>#Shot ${plan.shot_number}</span>`}</div>
        <h2 class="mt-2 truncate text-lg font-semibold text-zinc-100">${escapeHtml(plan.title)}</h2>
        <p class="mt-1 line-clamp-2 min-h-9 text-xs leading-[18px] text-zinc-500">${escapeHtml(plan.description)}</p>
        <div class="mt-4 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-3 text-xs text-zinc-500"><span class="truncate">${escapeHtml(plan.model)}</span><span class="shrink-0">${plan.generation_count} generations</span></div>
        <div class="mt-2 text-[11px] text-zinc-600">${plan.generated_at ? "Generated" : "Created"} ${escapeHtml(generationDate(plan.sort_at))}</div>
        <div class="mt-2 truncate text-[10px] text-zinc-500" title="${escapeHtml((plan.assignees || []).map((user) => user.display_name).join(", "))}">Assigned: ${escapeHtml((plan.assignees || []).map((user) => user.display_name).join(", ") || "No one")}</div>
      </div>
      </a>
      ${state.permissions.canEditPlans ? `<button class="cover-plan-card icon-button absolute right-3 top-3 z-10 bg-black/70 text-zinc-300 hover:text-acid" aria-label="Change cover for ${escapeHtml(plan.title)}" title="Change cover art"><i data-lucide="image-plus" class="h-3.5 w-3.5"></i></button>` : ""}
      ${state.permissions.canAssignPlans ? `<button class="assign-plan-card icon-button absolute right-12 top-3 z-10 bg-black/70 text-zinc-300 hover:text-acid" aria-label="Assign ${escapeHtml(plan.title)}" title="Manage assignments"><i data-lucide="users" class="h-3.5 w-3.5"></i></button>` : ""}
      ${state.permissions.canDeletePlans ? `<button class="delete-plan-card icon-button absolute right-3 top-12 z-10 border-red-300/10 bg-black/70 text-red-300/70 hover:text-red-200" aria-label="Delete ${escapeHtml(plan.title)}" title="Delete shot"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>` : ""}
    </article>`;
}

function render() {
  applyPlanCardSize();
  const plans = filteredPlans();
  els.grid.innerHTML = plans.map(shotCard).join("");
  els.count.textContent = `${plans.length} of ${state.plans.length} shots`;
  els.empty.classList.toggle("hidden", plans.length > 0);
  els.grid.querySelectorAll(".delete-plan-card").forEach((button) => button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = Number(button.closest("[data-plan-id]").dataset.planId);
    const plan = state.plans.find((item) => item.id === id);
    if (!window.confirm(`Delete #Seq ${plan.sequence_number} / #Shot ${plan.shot_number} and all of its generations and files? This cannot be undone.`)) return;
    const response = await fetch(`/api/plans/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return showToast(payload.error || "Could not delete shot");
    }
    state.plans = state.plans.filter((item) => item.id !== id);
    render();
    showToast("Shot deleted");
  }));
  els.grid.querySelectorAll(".cover-plan-card").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = Number(button.closest("[data-plan-id]").dataset.planId);
    openCoverEditor(id);
  }));
  els.grid.querySelectorAll(".assign-plan-card").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const plan = state.plans.find((item) => item.id === Number(button.closest("[data-plan-id]").dataset.planId));
    if (plan) window.openPlanAssignment?.(plan);
  }));
  els.grid.querySelectorAll("[data-plan-cover-video]").forEach((video) => {
    video.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.08, video.duration / 10);
    }, { once: true });
    video.addEventListener("seeked", () => video.pause(), { once: true });
  });
  lucide.createIcons();
}

function openModal() {
  for (const name of ["sequence_number", "shot_number"]) {
    const value = document.querySelector("#shotNavigationForm").elements[name].value;
    els.form.elements[name].value = value;
  }
  els.modal.classList.remove("hidden", "pointer-events-none");
  els.modal.classList.add("grid");
  els.modal.setAttribute("aria-hidden", "false");
  syncTestPlanFields();
  requestAnimationFrame(() => els.modalCard.classList.add("open"));
  setTimeout(() => els.form.elements.title.focus(), 220);
}

function syncTestPlanFields() {
  const testPlan = Boolean(els.testPlan?.checked);
  els.numberedPlanFields?.classList.toggle("hidden", testPlan);
  ["sequence_number", "shot_number"].forEach((name) => {
    const field = els.form.elements[name];
    if (field) { field.required = !testPlan; field.disabled = testPlan; }
  });
}

function closeModal() {
  els.modalCard.classList.remove("open");
  setTimeout(() => {
    els.modal.classList.add("hidden", "pointer-events-none");
    els.modal.classList.remove("grid");
    els.modal.setAttribute("aria-hidden", "true");
  }, 220);
}

function showToast(message) {
  els.toast.querySelector("span").textContent = message;
  els.toast.classList.remove("translate-y-4", "opacity-0");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add("translate-y-4", "opacity-0"), 2200);
}

document.addEventListener("shotfilterschange", render);
document.querySelectorAll("[data-planned-feature]").forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.plannedFeature} is planned for a future update`)));
els.search.addEventListener("input", (event) => { state.query = event.target.value; render(); });
els.filter.addEventListener("change", (event) => { state.status = event.target.value; render(); });
if (els.assignmentFilter) {
  els.assignmentFilter.add(new Option("Unassigned", "unassigned"));
  if (state.permissions.canAssignPlans) {
    const assignedUsers = new Map(state.plans.flatMap((plan) => plan.assignees || []).map((user) => [user.id, user.display_name]));
    [...assignedUsers.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => els.assignmentFilter.add(new Option(name, `user:${id}`)));
  }
}
els.assignmentFilter?.addEventListener("change", (event) => { state.assignment = event.target.value; render(); });
document.addEventListener("planassignmentchange", (event) => {
  state.plans = state.plans.map((plan) => plan.id === event.detail.id ? { ...plan, assignees: event.detail.assignees } : plan);
  if (els.assignmentFilter && state.permissions.canAssignPlans) {
    event.detail.assignees.forEach((user) => {
      if (![...els.assignmentFilter.options].some((option) => option.value === `user:${user.id}`)) els.assignmentFilter.add(new Option(user.display_name, `user:${user.id}`));
    });
  }
  render();
});
document.querySelector("#newPlanButton")?.addEventListener("click", openModal);
document.querySelector("#closeModalButton").addEventListener("click", closeModal);
document.querySelector("#cancelModalButton").addEventListener("click", closeModal);
document.querySelector("#modalBackdrop").addEventListener("click", closeModal);
document.querySelector("#mobileMenuButton").addEventListener("click", () => document.querySelector(".app-sidebar").classList.toggle("mobile-open"));
els.cardSizeRange?.addEventListener("input", (event) => {
  state.planCardSize = Number(event.target.value);
  window.localStorage.setItem("ai-hub-plan-card-size", String(state.planCardSize));
  applyPlanCardSize();
});
els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = els.form.querySelector("button[type='submit']");
  button.disabled = true;
  button.querySelector("span").textContent = "Creating...";
  const formData = new FormData(els.form);
  const body = {
    sequence_number: formData.get("sequence_number"),
    shot_number: formData.get("shot_number"),
    is_test_plan: Boolean(els.testPlan?.checked),
    title: formData.get("title"),
    description: formData.get("description")
  };
  try {
    const response = await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) return showToast(result.error || "Could not create plan");

    const refreshedResponse = await fetch(result.is_test_plan ? "/api/plans" : `/api/plans?sequence_number=${result.sequence_number}&shot_number=${result.shot_number}`);
    const refreshedPlans = refreshedResponse.ok ? await refreshedResponse.json() : [];
    const refreshed = refreshedPlans.find((plan) => plan.id === result.id) || result;
    state.plans = [refreshed, ...state.plans.filter((plan) => plan.id !== result.id)];
    els.form.reset();
    closeModal();
    render();
    showToast(result.is_test_plan ? "Test plan created" : "AI Plan created");
  } catch {
    showToast("The request was interrupted. Refresh the page to confirm the plan.");
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Create plan";
  }
});

els.testPlan?.addEventListener("change", syncTestPlanFields);

const coverModal = document.querySelector("#coverModal");
const coverModalCard = document.querySelector("#coverModalCard");
const coverCanvas = document.querySelector("#coverCropCanvas");
const coverContext = coverCanvas?.getContext("2d");
const coverFileInput = document.querySelector("#coverFileInput");
const coverZoomInput = document.querySelector("#coverZoomInput");
const saveCoverButton = document.querySelector("#saveCoverButton");
const coverEditor = { planId: null, image: null, offsetX: 0, offsetY: 0, dragging: false, pointerX: 0, pointerY: 0 };

function drawCoverCrop() {
  if (!coverContext || !coverEditor.image) return;
  const image = coverEditor.image;
  const zoom = Number(coverZoomInput.value || 1);
  const baseScale = Math.max(coverCanvas.width / image.naturalWidth, coverCanvas.height / image.naturalHeight);
  const width = image.naturalWidth * baseScale * zoom;
  const height = image.naturalHeight * baseScale * zoom;
  const maxX = Math.max(0, (width - coverCanvas.width) / 2);
  const maxY = Math.max(0, (height - coverCanvas.height) / 2);
  coverEditor.offsetX = Math.max(-maxX, Math.min(maxX, coverEditor.offsetX));
  coverEditor.offsetY = Math.max(-maxY, Math.min(maxY, coverEditor.offsetY));
  coverContext.clearRect(0, 0, coverCanvas.width, coverCanvas.height);
  coverContext.imageSmoothingEnabled = true;
  coverContext.imageSmoothingQuality = "high";
  coverContext.drawImage(image, (coverCanvas.width - width) / 2 + coverEditor.offsetX, (coverCanvas.height - height) / 2 + coverEditor.offsetY, width, height);
}

function resetCoverCrop() {
  coverEditor.image = null;
  coverEditor.offsetX = 0;
  coverEditor.offsetY = 0;
  if (coverContext) coverContext.clearRect(0, 0, coverCanvas.width, coverCanvas.height);
  if (coverZoomInput) {
    coverZoomInput.value = "1";
    coverZoomInput.disabled = true;
  }
  if (saveCoverButton) saveCoverButton.disabled = true;
  document.querySelector("#coverCropEmpty")?.classList.remove("hidden");
  if (coverFileInput) coverFileInput.value = "";
}

function openCoverEditor(id) {
  if (!coverModal) return;
  const plan = state.plans.find((item) => item.id === Number(id));
  if (!plan) return;
  coverEditor.planId = plan.id;
  resetCoverCrop();
  document.querySelector("#coverModalTitle").textContent = `Cover art · #Seq ${plan.sequence_number} / #Shot ${plan.shot_number}`;
  document.querySelector("#removeCustomCoverButton")?.classList.toggle("hidden", plan.cover_source !== "custom");
  coverModal.classList.remove("hidden", "pointer-events-none");
  coverModal.classList.add("grid");
  coverModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => coverModalCard.classList.add("open"));
}

function closeCoverEditor() {
  if (!coverModal) return;
  coverModalCard.classList.remove("open");
  setTimeout(() => {
    coverModal.classList.add("hidden", "pointer-events-none");
    coverModal.classList.remove("grid");
    coverModal.setAttribute("aria-hidden", "true");
    resetCoverCrop();
  }, 180);
}

document.querySelector("#chooseCoverImageButton")?.addEventListener("click", () => coverFileInput.click());
coverFileInput?.addEventListener("change", () => {
  const file = coverFileInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("Choose an image file for the cover");
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(imageUrl);
    coverEditor.image = image;
    coverEditor.offsetX = 0;
    coverEditor.offsetY = 0;
    coverZoomInput.value = "1";
    coverZoomInput.disabled = false;
    saveCoverButton.disabled = false;
    document.querySelector("#coverCropEmpty")?.classList.add("hidden");
    drawCoverCrop();
  };
  image.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    showToast("This image could not be opened");
  };
  image.src = imageUrl;
});
coverZoomInput?.addEventListener("input", drawCoverCrop);

coverCanvas?.addEventListener("pointerdown", (event) => {
  if (!coverEditor.image) return;
  coverEditor.dragging = true;
  coverEditor.pointerX = event.clientX;
  coverEditor.pointerY = event.clientY;
  coverCanvas.setPointerCapture(event.pointerId);
  coverCanvas.style.cursor = "grabbing";
});
coverCanvas?.addEventListener("pointermove", (event) => {
  if (!coverEditor.dragging) return;
  const rect = coverCanvas.getBoundingClientRect();
  coverEditor.offsetX += (event.clientX - coverEditor.pointerX) * (coverCanvas.width / rect.width);
  coverEditor.offsetY += (event.clientY - coverEditor.pointerY) * (coverCanvas.height / rect.height);
  coverEditor.pointerX = event.clientX;
  coverEditor.pointerY = event.clientY;
  drawCoverCrop();
});
function finishCoverDrag(event) {
  if (!coverEditor.dragging) return;
  coverEditor.dragging = false;
  coverCanvas.releasePointerCapture?.(event.pointerId);
  coverCanvas.style.cursor = "grab";
}
coverCanvas?.addEventListener("pointerup", finishCoverDrag);
coverCanvas?.addEventListener("pointercancel", finishCoverDrag);

saveCoverButton?.addEventListener("click", async () => {
  if (!coverEditor.image || !coverEditor.planId) return;
  saveCoverButton.disabled = true;
  saveCoverButton.querySelector("span").textContent = "Saving...";
  const blob = await new Promise((resolve) => coverCanvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) {
    saveCoverButton.disabled = false;
    saveCoverButton.querySelector("span").textContent = "Save cover";
    return showToast("The cropped cover could not be created");
  }
  const form = new FormData();
  form.append("file", blob, `plan-${coverEditor.planId}-cover.jpg`);
  const response = await fetch(`/api/plans/${coverEditor.planId}/cover`, { method: "POST", body: form });
  const payload = await response.json().catch(() => ({}));
  saveCoverButton.querySelector("span").textContent = "Save cover";
  if (!response.ok) {
    saveCoverButton.disabled = false;
    return showToast(payload.error || "Could not save this cover");
  }
  state.plans = state.plans.map((plan) => plan.id === payload.id ? payload : plan);
  closeCoverEditor();
  render();
  showToast("Custom cover saved");
});

document.querySelector("#removeCustomCoverButton")?.addEventListener("click", async () => {
  if (!coverEditor.planId) return;
  const response = await fetch(`/api/plans/${coverEditor.planId}/cover`, { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(payload.error || "Could not restore the automatic cover");
  state.plans = state.plans.map((plan) => plan.id === payload.id ? payload : plan);
  closeCoverEditor();
  render();
  showToast("Automatic cover restored");
});
document.querySelector("#closeCoverModalButton")?.addEventListener("click", closeCoverEditor);
document.querySelector("#cancelCoverModalButton")?.addEventListener("click", closeCoverEditor);
document.querySelector("#coverModalBackdrop")?.addEventListener("click", closeCoverEditor);

const accountButton = document.querySelector("#accountButton");
const accountMenu = document.querySelector("#accountMenu");
const usersModal = document.querySelector("#usersModal");
const usersModalCard = document.querySelector("#usersModalCard");
let accountUsers = [];

accountButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  accountMenu.classList.toggle("hidden");
});

document.addEventListener("click", (event) => {
  if (accountMenu && !accountMenu.contains(event.target) && !accountButton.contains(event.target)) accountMenu.classList.add("hidden");
});

document.querySelector("#logoutButton")?.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  window.location.assign(`${window.__AI_HUB_BASE__ || ""}/login`);
});

function userInitials(name) {
  return String(name || "").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatLastLogin(value) {
  if (!value) return "Never signed in";
  return `Last seen ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value.replace(" ", "T") + "Z"))}`;
}

async function loadUsers() {
  const response = await fetch("/api/users");
  const payload = await response.json();
  if (!response.ok) return showToast(payload.error || "Could not load accounts");
  accountUsers = payload.users;
  state.workspaceRoles = payload.roles;
  state.roleDefinitions = Object.fromEntries(payload.roles.map((role) => [role.name, role.description]));
  refreshRoleSelect();
  renderUsers();
  renderRoles();
}

function refreshRoleSelect() {
  const select = document.querySelector("#newUserForm [name='role']");
  if (!select) return;
  const current = select.value || "Generator";
  select.innerHTML = state.workspaceRoles.map((role) => `<option ${role.name === current ? "selected" : ""}>${escapeHtml(role.name)}</option>`).join("");
  if (![...select.options].some((option) => option.selected)) select.value = "Generator";
  updateRoleDescription();
}

function renderUsers() {
  const list = document.querySelector("#usersList");
  if (!list) return;
  list.innerHTML = accountUsers.map((user) => `
    <article class="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 ${user.active ? "" : "opacity-55"}" data-user-id="${user.id}">
      <div class="flex items-center gap-3">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full ${user.role === "Admin" ? "bg-acid text-black" : "bg-white/[0.08] text-zinc-300"} text-[10px] font-bold">${userInitials(user.display_name)}</div>
        <div class="min-w-0 flex-1"><div class="flex items-center gap-2"><span class="truncate text-sm font-semibold text-zinc-200">${escapeHtml(user.display_name)}</span>${user.must_set_password ? `<span class="shrink-0 rounded-full border border-amber-300/15 bg-amber-300/[0.07] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-amber-300">Awaiting setup</span>` : ""}</div><div class="mt-1 text-[10px] text-zinc-600">@${escapeHtml(user.username)} · ${formatLastLogin(user.last_login_at)}</div></div>
      </div>
      <div class="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3">
        <select class="user-role h-8 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-2 text-[11px] text-zinc-400 outline-none" aria-label="Role for ${escapeHtml(user.display_name)}">${state.workspaceRoles.map((role) => `<option ${role.name === user.role ? "selected" : ""}>${escapeHtml(role.name)}</option>`).join("")}</select>
        <button class="toggle-user h-8 rounded-lg border border-white/[0.08] px-3 text-[10px] font-semibold ${user.active ? "text-zinc-500 hover:text-red-300" : "text-acid"}">${user.active ? "Disable" : "Enable"}</button>
      </div>
      ${state.currentUser?.role === "Admin" && state.currentUser.id !== user.id && user.active ? `<div class="mt-2"><button type="button" class="open-password-reset text-[10px] text-zinc-600 transition hover:text-acid">Reset forgotten password</button><form class="password-reset-form mt-3 hidden space-y-2 rounded-xl border border-amber-300/10 bg-amber-300/[0.025] p-3"><label><span class="field-label">New password</span><input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" class="field h-9 py-0 text-xs" required /></label><label><span class="field-label">Confirm password</span><input name="confirmation" type="password" minlength="10" maxlength="128" autocomplete="new-password" class="field h-9 py-0 text-xs" required /></label><div class="flex items-center justify-end gap-2"><button type="button" class="cancel-password-reset text-[10px] text-zinc-600 hover:text-white">Cancel</button><button type="submit" class="ghost-button h-8 px-3 text-[10px]">Save password</button></div></form></div>` : ""}
    </article>`).join("");

  list.querySelectorAll(".user-role").forEach((select) => select.addEventListener("change", async () => {
    const id = Number(select.closest("[data-user-id]").dataset.userId);
    await updateUserAccount(id, { role: select.value });
  }));
  list.querySelectorAll(".toggle-user").forEach((button) => button.addEventListener("click", async () => {
    const id = Number(button.closest("[data-user-id]").dataset.userId);
    const user = accountUsers.find((item) => item.id === id);
    await updateUserAccount(id, { active: !user.active });
  }));
  list.querySelectorAll(".open-password-reset").forEach((button) => button.addEventListener("click", () => {
    button.closest("[data-user-id]").querySelector(".password-reset-form").classList.remove("hidden");
    button.classList.add("hidden");
    button.closest("[data-user-id]").querySelector("input[name='password']").focus();
  }));
  list.querySelectorAll(".cancel-password-reset").forEach((button) => button.addEventListener("click", () => {
    const card = button.closest("[data-user-id]");
    card.querySelector(".password-reset-form").classList.add("hidden");
    card.querySelector(".open-password-reset").classList.remove("hidden");
  }));
  list.querySelectorAll(".password-reset-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const card = form.closest("[data-user-id]");
    const user = accountUsers.find((item) => item.id === Number(card.dataset.userId));
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    const response = await fetch(`/api/users/${user.id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const payload = await response.json().catch(() => ({}));
    button.disabled = false;
    if (!response.ok) return showToast(payload.error || "Could not reset the password");
    form.reset();
    form.classList.add("hidden");
    card.querySelector(".open-password-reset").classList.remove("hidden");
    showToast(`Password reset for @${user.username}; their active sessions were signed out`);
    await loadUsers();
  }));
}

const rolePermissionFields = [
  ["can_create_plans", "Create shots"], ["can_edit_plans", "Edit generations"],
  ["can_delete_plans", "Delete shots"], ["can_manage_workflow", "Change workflow"],
  ["can_review_plans", "Review shots"], ["can_manage_libraries", "Manage libraries"],
  ["can_manage_accounts", "Manage accounts"]
];

function renderRoles() {
  const list = document.querySelector("#rolesList");
  if (!list) return;
  document.querySelector("#roleCount").textContent = `${state.workspaceRoles.length} roles`;
  list.innerHTML = state.workspaceRoles.map((role) => `
    <article class="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5" data-role-id="${role.id}">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2"><input class="role-name bg-transparent text-sm font-semibold text-zinc-200 outline-none" value="${escapeHtml(role.name)}" maxlength="40" ${role.protected ? "disabled" : ""} />${role.protected ? `<span class="rounded-full border border-acid/15 px-2 py-0.5 text-[8px] uppercase tracking-wider text-acid">Built in</span>` : ""}</div>
          <input class="role-description mt-1 w-full bg-transparent text-[10px] text-zinc-600 outline-none" value="${escapeHtml(role.description || "")}" maxlength="240" ${role.protected ? "disabled" : ""} />
        </div>
        <span class="shrink-0 text-[9px] text-zinc-700">${role.user_count} user${role.user_count === 1 ? "" : "s"}</span>
      </div>
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/[0.05] pt-3 text-[9px] text-zinc-500">${rolePermissionFields.map(([field, label]) => `<label class="flex items-center gap-1.5"><input type="checkbox" data-role-permission="${field}" ${role[field] ? "checked" : ""} ${role.protected ? "disabled" : ""} />${label}</label>`).join("")}</div>
      ${role.protected ? "" : `<div class="mt-3 flex justify-end gap-2"><button class="delete-role text-[10px] text-red-300/60 hover:text-red-200">Delete</button><button class="save-role ghost-button h-8 px-3 text-[10px]">Save role</button></div>`}
    </article>`).join("");
  list.querySelectorAll(".save-role").forEach((button) => button.addEventListener("click", () => saveRole(button.closest("[data-role-id]"))));
  list.querySelectorAll(".delete-role").forEach((button) => button.addEventListener("click", () => removeRole(button.closest("[data-role-id]"))));
}

function roleBodyFromElement(element) {
  const body = { name: element.querySelector(".role-name").value.trim(), description: element.querySelector(".role-description").value.trim() };
  rolePermissionFields.forEach(([field]) => { body[field] = element.querySelector(`[data-role-permission='${field}']`).checked; });
  return body;
}

async function saveRole(element) {
  const response = await fetch(`/api/roles/${element.dataset.roleId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roleBodyFromElement(element)) });
  const payload = await response.json();
  if (!response.ok) return showToast(payload.error || "Could not update role");
  showToast("Role updated");
  await loadUsers();
}

async function removeRole(element) {
  const role = state.workspaceRoles.find((item) => item.id === Number(element.dataset.roleId));
  if (!window.confirm(`Delete the ${role.name} role?`)) return;
  const response = await fetch(`/api/roles/${role.id}`, { method: "DELETE" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return showToast(payload.error || "Could not delete role");
  }
  showToast("Role deleted");
  await loadUsers();
}

async function updateUserAccount(id, changes) {
  const response = await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
  const payload = await response.json();
  if (!response.ok) { showToast(payload.error || "Could not update account"); return loadUsers(); }
  showToast("Account updated");
  await loadUsers();
}

function updateRoleDescription() {
  const roleSelect = document.querySelector("#newUserForm [name='role']");
  const description = document.querySelector("#roleDescription");
  if (roleSelect && description) description.textContent = state.roleDefinitions[roleSelect.value];
}

async function openUsersModal() {
  if (!usersModal) return;
  accountMenu?.classList.add("hidden");
  usersModal.classList.remove("hidden", "pointer-events-none");
  usersModal.classList.add("grid");
  usersModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => usersModalCard.classList.add("open"));
  updateRoleDescription();
  await loadUsers();
}

function closeUsersModal() {
  if (!usersModal) return;
  usersModalCard.classList.remove("open");
  setTimeout(() => {
    usersModal.classList.add("hidden", "pointer-events-none");
    usersModal.classList.remove("grid");
    usersModal.setAttribute("aria-hidden", "true");
  }, 220);
}

document.querySelector("#manageAccountsButton")?.addEventListener("click", openUsersModal);
document.querySelector("#teamNavButton")?.addEventListener("click", openUsersModal);
document.querySelector("#closeUsersModalButton")?.addEventListener("click", closeUsersModal);
document.querySelector("#usersModalBackdrop")?.addEventListener("click", closeUsersModal);
document.querySelector("#newUserForm [name='role']")?.addEventListener("change", updateRoleDescription);

document.querySelector("#newUserForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.querySelector("span").textContent = "Creating...";
  const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
  const payload = await response.json();
  button.disabled = false;
  button.querySelector("span").textContent = "Create account";
  if (!response.ok) return showToast(payload.error || "Could not create account");
  form.reset();
  updateRoleDescription();
  showToast(`@${payload.username} can now set their password`);
  await loadUsers();
});

document.querySelector("#newRoleForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const body = { name: data.get("name"), description: data.get("description") };
  rolePermissionFields.forEach(([field]) => { body[field] = data.has(field); });
  const response = await fetch("/api/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) return showToast(payload.error || "Could not create role");
  form.reset();
  showToast("Custom role created");
  await loadUsers();
});

const catalogsModal = document.querySelector("#catalogsModal");
const catalogsModalCard = document.querySelector("#catalogsModalCard");
let activeCatalogType = "models";

const catalogCopy = {
  models: { singular: "AI model", eyebrow: "Available models", title: "AI model catalog" },
  platforms: { singular: "generation platform", eyebrow: "Platforms & frozen pricing", title: "Generation platform catalog" },
  resource_roles: { singular: "resource type", eyebrow: "Generation resource types", title: "Resource type catalog" },
  asset_categories: { singular: "asset category", eyebrow: "Asset Library categories", title: "Asset category catalog" }
};

async function loadCatalogs() {
  const response = await fetch("/api/admin/catalogs");
  const payload = await response.json();
  if (!response.ok) return showToast(payload.error || "Could not load generation settings");
  state.generationCatalogs = payload;
  renderCatalogs();
}

function renderCatalogs() {
  if (!catalogsModal) return;
  const copy = catalogCopy[activeCatalogType];
  const items = state.generationCatalogs[activeCatalogType] || [];
  document.querySelector("#catalogFormEyebrow").textContent = `Add ${copy.singular}`;
  document.querySelector("#catalogListEyebrow").textContent = copy.eyebrow;
  document.querySelector("#catalogListTitle").textContent = copy.title;
  document.querySelector("#catalogItemCount").textContent = `${items.filter((item) => item.active).length} active`;
  document.querySelector("#catalogPriceField").classList.toggle("hidden", activeCatalogType !== "platforms");
  document.querySelectorAll(".catalog-tab").forEach((button) => {
    const active = button.dataset.catalog === activeCatalogType;
    button.classList.toggle("active", active);
    button.classList.toggle("text-zinc-600", !active);
  });

  const list = document.querySelector("#catalogItemsList");
  list.innerHTML = items.map((item) => {
    const locked = activeCatalogType === "resource_roles" && item.name === "Output";
    return `
    <article class="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 ${item.active ? "" : "opacity-50"}" data-catalog-item="${item.id}">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input class="catalog-item-name field h-9 flex-1 py-0 text-xs" value="${escapeHtml(item.name)}" maxlength="100" aria-label="Catalog item name" ${locked ? "disabled" : ""} />
        ${activeCatalogType === "platforms" ? `<div class="relative w-full sm:w-40"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-600">$</span><input class="catalog-item-price field h-9 py-0 pl-7 text-xs" type="number" min="0" step="0.000001" value="${Number(item.token_price || 0)}" aria-label="Price per token" /></div>` : ""}
        ${locked ? `<span class="rounded-full border border-acid/15 bg-acid/[0.05] px-3 py-2 text-[9px] font-semibold text-acid">Core type</span>` : `<button class="catalog-save ghost-button h-9 px-3 text-[10px]">Save</button><button class="catalog-toggle h-9 rounded-full border border-white/[0.08] px-3 text-[10px] font-semibold ${item.active ? "text-zinc-500 hover:text-red-300" : "text-acid"}">${item.active ? "Remove" : "Restore"}</button>`}
      </div>
      ${activeCatalogType === "platforms" ? `<div class="mt-2 text-[9px] text-zinc-700">Current price: $${Number(item.token_price || 0).toFixed(6)} per token</div>` : ""}
    </article>`;
  }).join("");

  list.querySelectorAll(".catalog-save").forEach((button) => button.addEventListener("click", async () => {
    const item = button.closest("[data-catalog-item]");
    const body = { name: item.querySelector(".catalog-item-name").value.trim() };
    if (activeCatalogType === "platforms") body.token_price = Number(item.querySelector(".catalog-item-price").value || 0);
    await updateCatalog(Number(item.dataset.catalogItem), body);
  }));
  list.querySelectorAll(".catalog-toggle").forEach((button) => button.addEventListener("click", async () => {
    const item = button.closest("[data-catalog-item]");
    const current = items.find((candidate) => candidate.id === Number(item.dataset.catalogItem));
    await updateCatalog(current.id, { active: !current.active });
  }));
}

async function updateCatalog(id, body) {
  const response = await fetch(`/api/admin/catalogs/${activeCatalogType}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) return showToast(payload.error || "Could not update this option");
  showToast("Generation setting updated");
  await loadCatalogs();
}

async function openCatalogsModal() {
  if (!catalogsModal) return;
  accountMenu?.classList.add("hidden");
  catalogsModal.classList.remove("hidden", "pointer-events-none");
  catalogsModal.classList.add("grid");
  catalogsModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => catalogsModalCard.classList.add("open"));
  await loadCatalogs();
}

function closeCatalogsModal() {
  if (!catalogsModal) return;
  catalogsModalCard.classList.remove("open");
  setTimeout(() => {
    catalogsModal.classList.add("hidden", "pointer-events-none");
    catalogsModal.classList.remove("grid");
    catalogsModal.setAttribute("aria-hidden", "true");
  }, 220);
}

document.querySelector("#manageCatalogsButton")?.addEventListener("click", openCatalogsModal);
document.querySelector("#catalogsNavButton")?.addEventListener("click", openCatalogsModal);
document.querySelector("#closeCatalogsModalButton")?.addEventListener("click", closeCatalogsModal);
document.querySelector("#catalogsModalBackdrop")?.addEventListener("click", closeCatalogsModal);
document.querySelectorAll(".catalog-tab").forEach((button) => button.addEventListener("click", () => { activeCatalogType = button.dataset.catalog; renderCatalogs(); }));
document.querySelector("#catalogItemForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const body = { name: formData.get("name") };
  if (activeCatalogType === "platforms") body.token_price = Number(formData.get("token_price") || 0);
  const response = await fetch(`/api/admin/catalogs/${activeCatalogType}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) return showToast(payload.error || "Could not add this option");
  form.reset();
  showToast(`${catalogCopy[activeCatalogType].singular} added`);
  await loadCatalogs();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (coverModal && !coverModal.classList.contains("hidden")) closeCoverEditor();
    else if (catalogsModal && !catalogsModal.classList.contains("hidden")) closeCatalogsModal();
    else if (usersModal && !usersModal.classList.contains("hidden")) closeUsersModal();
    else if (!els.modal.classList.contains("hidden")) closeModal();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); els.search.focus(); }
});

render();
