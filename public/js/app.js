/* global lucide */

const statusGroups = [
  { key: "Briefing", statuses: ["Idea", "Brief Ready"], target: "Brief Ready", label: "Briefing", dot: "bg-zinc-500" },
  { key: "Creating", statuses: ["Generating", "Revision"], target: "Generating", label: "Creating", dot: "bg-amber-400" },
  { key: "Review", statuses: ["Review"], target: "Review", label: "Review", dot: "bg-sky-400" },
  { key: "Approved", statuses: ["Approved", "Delivered"], target: "Approved", label: "Approved", dot: "bg-acid" }
];

const state = {
  plans: window.__AI_HUB_PLANS__ || [],
  currentUser: window.__AI_HUB_CURRENT_USER__ || null,
  permissions: window.__AI_HUB_PERMISSIONS__ || {},
  roleDefinitions: window.__AI_HUB_ROLES__ || {},
  generationCatalogs: window.__AI_HUB_GENERATION_CATALOGS__ || { models: [], platforms: [], resource_roles: [] },
  query: "",
  status: "all",
  view: "board"
};

const els = {
  board: document.querySelector("#boardView"),
  gallery: document.querySelector("#galleryView"),
  table: document.querySelector("#tableView"),
  empty: document.querySelector("#emptyState"),
  stats: document.querySelector("#statsRow"),
  search: document.querySelector("#searchInput"),
  filter: document.querySelector("#statusFilter"),
  modal: document.querySelector("#newPlanModal"),
  modalCard: document.querySelector("#modalCard"),
  form: document.querySelector("#newPlanForm"),
  toast: document.querySelector("#toast")
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function statusClass(status) {
  const classes = {
    "Idea": "border-zinc-700/70 bg-zinc-800/60 text-zinc-400",
    "Brief Ready": "border-violet-400/20 bg-violet-400/10 text-violet-300",
    "Generating": "border-amber-400/20 bg-amber-400/10 text-amber-300",
    "Revision": "border-orange-400/20 bg-orange-400/10 text-orange-300",
    "Review": "border-sky-400/20 bg-sky-400/10 text-sky-300",
    "Approved": "border-lime-400/20 bg-lime-400/10 text-lime-300",
    "Delivered": "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
  };
  return classes[status] || classes.Idea;
}

function priorityClass(priority) {
  return priority === "Critical" ? "text-red-300" : priority === "High" ? "text-amber-300" : "text-zinc-500";
}

function filteredPlans() {
  const query = state.query.toLowerCase().trim();
  return state.plans.filter((plan) => {
    const matchesStatus = state.status === "all" || plan.status === state.status;
    const haystack = [plan.title, plan.shot_code, plan.model, plan.owner, ...(plan.tags || [])].join(" ").toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
}

function mediaStyle(plan) {
  return `--image-position:${escapeHtml(plan.image_position || "0% 0%")}`;
}

function compactCard(plan) {
  return `
    <article class="plan-card group" tabindex="0" role="button" draggable="${Boolean(state.permissions.canManageWorkflow && !(["Approved", "Delivered"].includes(plan.status) && state.currentUser.role === "Creator"))}" data-plan-id="${plan.id}" aria-label="Open ${escapeHtml(plan.title)}">
      <div class="media-frame relative aspect-[16/10] overflow-hidden" style="${mediaStyle(plan)}">
        <div class="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <span class="status-pill ${statusClass(plan.status)} backdrop-blur-xl">${escapeHtml(plan.status)}</span>
        </div>
        ${plan.issue ? `<div class="absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-lg border border-orange-300/10 bg-black/55 px-2.5 py-2 text-[10px] text-orange-200/90 backdrop-blur"><i data-lucide="triangle-alert" class="h-3.5 w-3.5 shrink-0"></i><span class="truncate">${escapeHtml(plan.issue)}</span></div>` : ""}
      </div>
      <div class="p-4">
        <div class="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-600"><span>${escapeHtml(plan.shot_code)}</span><span class="${priorityClass(plan.priority)}">${escapeHtml(plan.priority)}</span></div>
        <h3 class="mt-2 truncate text-[15px] font-semibold tracking-[-0.01em] text-zinc-100">${escapeHtml(plan.title)}</h3>
        <p class="mt-1.5 line-clamp-2 min-h-9 text-xs leading-[18px] text-zinc-500">${escapeHtml(plan.description)}</p>
        <div class="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-3 text-[11px] text-zinc-600">
          <span class="flex min-w-0 items-center gap-1.5"><i data-lucide="sparkles" class="h-3.5 w-3.5 shrink-0"></i><span class="truncate">${escapeHtml(plan.model)}</span></span>
          <span class="ml-2 flex shrink-0 items-center gap-1.5"><i data-lucide="layers-3" class="h-3.5 w-3.5"></i>${plan.experiments_count}</span>
        </div>
      </div>
    </article>`;
}

function galleryCard(plan) {
  return `
    <article class="plan-card group" tabindex="0" role="button" data-plan-id="${plan.id}">
      <div class="media-frame relative aspect-video" style="${mediaStyle(plan)}">
        <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/10"></div>
        <div class="absolute inset-x-0 bottom-0 p-4">
          <div class="mb-2 flex items-center gap-2"><span class="status-pill ${statusClass(plan.status)} backdrop-blur-xl">${escapeHtml(plan.status)}</span><span class="text-[10px] font-semibold tracking-[0.1em] text-white/55">${escapeHtml(plan.shot_code)}</span></div>
          <h3 class="text-lg font-semibold tracking-tight text-white">${escapeHtml(plan.title)}</h3>
          <div class="mt-1.5 flex gap-3 text-[11px] text-white/55"><span>${escapeHtml(plan.model)}</span><span>${plan.experiments_count} tests</span><span>${plan.quality ? `${plan.quality}/5` : "Unrated"}</span></div>
        </div>
      </div>
    </article>`;
}

function tableMarkup(plans) {
  const rows = plans.map((plan) => `
    <button class="grid w-full grid-cols-[64px_minmax(220px,1.6fr)_140px_140px_100px_90px] items-center gap-4 border-t border-white/[0.06] px-4 py-3 text-left transition hover:bg-white/[0.035]" data-plan-id="${plan.id}">
      <span class="media-frame aspect-video rounded-lg" style="${mediaStyle(plan)}"></span>
      <span class="min-w-0"><span class="block truncate text-sm font-semibold text-zinc-200">${escapeHtml(plan.title)}</span><span class="mt-1 block text-[10px] font-semibold tracking-wider text-zinc-600">${escapeHtml(plan.shot_code)}</span></span>
      <span class="status-pill w-max ${statusClass(plan.status)}">${escapeHtml(plan.status)}</span>
      <span class="truncate text-xs text-zinc-500">${escapeHtml(plan.model)}</span>
      <span class="text-xs text-zinc-500">${plan.quality ? `${plan.quality}/5` : "—"}</span>
      <span class="text-xs text-zinc-500">${formatDate(plan.due_date)}</span>
    </button>`).join("");
  return `<div class="min-w-[860px]"><div class="grid grid-cols-[64px_minmax(220px,1.6fr)_140px_140px_100px_90px] gap-4 px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-700"><span>Media</span><span>Plan</span><span>Status</span><span>Model</span><span>Quality</span><span>Due</span></div>${rows}</div>`;
}

function renderStats() {
  const total = state.plans.length;
  const active = state.plans.filter((plan) => ["Generating", "Revision"].includes(plan.status)).length;
  const review = state.plans.filter((plan) => plan.status === "Review").length;
  const approved = state.plans.filter((plan) => ["Approved", "Delivered"].includes(plan.status)).length;
  const tests = state.plans.reduce((sum, plan) => sum + Number(plan.experiments_count || 0), 0);
  const stats = [
    ["Total plans", total, "In this workspace", "clapperboard"],
    ["In creation", active, `${tests} generations logged`, "wand-sparkles"],
    ["Ready to review", review, "Director action needed", "messages-square"],
    ["Approved", approved, `${Math.round((approved / Math.max(total, 1)) * 100)}% of production`, "circle-check"]
  ];
  els.stats.innerHTML = stats.map(([label, value, note, icon]) => `
    <div class="bg-[#0f1012] p-4 sm:p-5">
      <div class="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600"><span>${label}</span><i data-lucide="${icon}" class="h-4 w-4"></i></div>
      <div class="mt-3 text-2xl font-semibold tracking-tight text-zinc-100">${value}</div>
      <div class="mt-1 text-[11px] text-zinc-600">${note}</div>
    </div>`).join("");
}

function render() {
  const plans = filteredPlans();
  renderStats();

  els.board.innerHTML = statusGroups.map((group) => {
    const items = plans.filter((plan) => group.statuses.includes(plan.status));
    return `
      <div class="board-column min-w-0 rounded-2xl border border-transparent p-1 transition" data-column="${group.key}">
        <div class="mb-3 flex items-center justify-between px-2">
          <div class="flex items-center gap-2 text-xs font-semibold text-zinc-400"><span class="h-1.5 w-1.5 rounded-full ${group.dot}"></span>${group.label}</div>
          <span class="rounded-full bg-white/[0.045] px-2 py-1 text-[10px] font-semibold text-zinc-600">${items.length}</span>
        </div>
        <div class="space-y-3" data-drop-status="${group.target}">${items.map(compactCard).join("")}</div>
      </div>`;
  }).join("");
  els.gallery.innerHTML = plans.map(galleryCard).join("");
  els.table.innerHTML = tableMarkup(plans);

  [els.board, els.gallery, els.table].forEach((element) => element.classList.add("hidden"));
  if (state.view === "board") els.board.classList.remove("hidden");
  if (state.view === "gallery") { els.gallery.classList.remove("hidden"); els.gallery.classList.add("grid"); }
  if (state.view === "table") els.table.classList.remove("hidden");
  els.empty.classList.toggle("hidden", plans.length > 0);
  document.querySelectorAll(".view-button").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  bindPlanEvents();
  bindDragEvents();
  lucide.createIcons();
}

function bindPlanEvents() {
  document.querySelectorAll("[data-plan-id]").forEach((element) => {
    element.addEventListener("click", () => {
      openPlan(Number(element.dataset.planId));
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPlan(Number(element.dataset.planId)); }
    });
  });
}

function bindDragEvents() {
  document.querySelectorAll(".plan-card[draggable='true']").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", card.dataset.planId);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });
  document.querySelectorAll(".board-column").forEach((column) => {
    column.addEventListener("dragover", (event) => { event.preventDefault(); column.classList.add("drag-over"); });
    column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
    column.addEventListener("drop", async (event) => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const id = Number(event.dataTransfer.getData("text/plain"));
      const status = column.querySelector("[data-drop-status]").dataset.dropStatus;
      const plan = state.plans.find((item) => item.id === id);
      if (!plan || !allowedStatusesForPlan(plan).includes(status)) {
        showToast("Your role cannot move a plan there");
        return;
      }
      await setPlanStatus(id, status);
    });
  });
}

function allowedStatusesForPlan(plan) {
  if (["Admin", "Supervisor"].includes(state.currentUser.role)) return state.permissions.allowedStatuses || [];
  if (state.currentUser.role === "Creator" && ["Approved", "Delivered"].includes(plan.status)) return [];
  if (state.currentUser.role === "Reviewer" && plan.status !== "Review") return [];
  return state.permissions.allowedStatuses || [];
}

function openPlan(id) {
  window.location.assign(`/plans/${id}`);
}

async function setPlanStatus(id, status) {
  const response = await fetch(`/api/plans/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  if (!response.ok) return showToast("Could not update status");
  const updated = await response.json();
  const index = state.plans.findIndex((plan) => plan.id === id);
  state.plans[index] = { ...state.plans[index], ...updated };
  render();
  showToast(`Moved to ${status}`);
}

function openModal() {
  els.modal.classList.remove("hidden", "pointer-events-none");
  els.modal.classList.add("grid");
  els.modal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => els.modalCard.classList.add("open"));
  setTimeout(() => els.form.elements.title.focus(), 220);
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

document.querySelectorAll(".view-button").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; render(); }));
document.querySelectorAll("[data-planned-feature]").forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.plannedFeature} is planned for a future update`)));
els.search.addEventListener("input", (event) => { state.query = event.target.value; render(); });
els.filter.addEventListener("change", (event) => { state.status = event.target.value; render(); });
document.querySelector("#newPlanButton")?.addEventListener("click", openModal);
document.querySelector("#closeModalButton").addEventListener("click", closeModal);
document.querySelector("#cancelModalButton").addEventListener("click", closeModal);
document.querySelector("#modalBackdrop").addEventListener("click", closeModal);
document.querySelector("#mobileMenuButton").addEventListener("click", () => document.querySelector(".app-sidebar").classList.toggle("mobile-open"));

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = els.form.querySelector("button[type='submit']");
  button.disabled = true;
  button.querySelector("span").textContent = "Creating...";
  const body = Object.fromEntries(new FormData(els.form));
  const response = await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  button.disabled = false;
  button.querySelector("span").textContent = "Create plan";
  if (!response.ok) return showToast(result.error || "Could not create plan");
  state.plans.unshift(result);
  els.form.reset();
  closeModal();
  render();
  showToast("AI Plan created");
  setTimeout(() => openPlan(result.id), 260);
});

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
  window.location.assign("/login");
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
  renderUsers();
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
        <select class="user-role h-8 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-2 text-[11px] text-zinc-400 outline-none" aria-label="Role for ${escapeHtml(user.display_name)}">${Object.keys(state.roleDefinitions).map((role) => `<option ${role === user.role ? "selected" : ""}>${role}</option>`).join("")}</select>
        <button class="toggle-user h-8 rounded-lg border border-white/[0.08] px-3 text-[10px] font-semibold ${user.active ? "text-zinc-500 hover:text-red-300" : "text-acid"}">${user.active ? "Disable" : "Enable"}</button>
      </div>
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

const catalogsModal = document.querySelector("#catalogsModal");
const catalogsModalCard = document.querySelector("#catalogsModalCard");
let activeCatalogType = "models";

const catalogCopy = {
  models: { singular: "AI model", eyebrow: "Available models", title: "AI model catalog" },
  platforms: { singular: "generation platform", eyebrow: "Platforms & frozen pricing", title: "Generation platform catalog" },
  resource_roles: { singular: "resource type", eyebrow: "Generation resource types", title: "Resource type catalog" }
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
    if (catalogsModal && !catalogsModal.classList.contains("hidden")) closeCatalogsModal();
    else if (usersModal && !usersModal.classList.contains("hidden")) closeUsersModal();
    else if (!els.modal.classList.contains("hidden")) closeModal();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); els.search.focus(); }
});

render();
