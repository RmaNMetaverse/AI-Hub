/* global lucide */

(function () {
  let dialog;
  let currentPlan;
  let returnFocus;

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function close() {
    if (!dialog) return;
    dialog.classList.add("hidden");
    dialog.classList.remove("flex");
    returnFocus?.focus();
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.className = "modal-backdrop fixed inset-0 z-[85] hidden items-center justify-center bg-black/80 p-4";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "assignmentTitle");
    dialog.innerHTML = `<form id="assignmentForm" class="w-full max-w-lg rounded-3xl border border-white/10 bg-[#111214] p-5 shadow-float sm:p-6">
      <div class="flex items-start justify-between gap-3"><div><div class="text-[10px] font-semibold uppercase tracking-widest text-acid">Plan assignment</div><h2 id="assignmentTitle" class="mt-2 text-xl font-semibold text-white"></h2></div><button type="button" class="assignment-close icon-button" aria-label="Close"><i data-lucide="x" class="h-4 w-4"></i></button></div>
      <p class="mt-2 text-xs text-zinc-500">Select everyone responsible for this plan. Newly assigned users will be notified.</p>
      <div id="assignmentUsers" class="mt-5 max-h-[48vh] space-y-2 overflow-y-auto"></div>
      <p id="assignmentError" class="mt-3 hidden text-xs text-red-300" role="alert"></p>
      <div class="mt-5 flex justify-end gap-2"><button type="button" class="assignment-close ghost-button">Cancel</button><button type="submit" class="primary-button"><span>Save assignments</span></button></div>
    </form>`;
    document.body.append(dialog);
    dialog.querySelectorAll(".assignment-close").forEach((button) => button.addEventListener("click", close));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    dialog.querySelector("#assignmentForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = dialog.querySelector('button[type="submit"]');
      button.disabled = true;
      const userIds = [...dialog.querySelectorAll('input[name="assignee"]:checked')].map((input) => Number(input.value));
      try {
        const response = await fetch(`/api/plans/${currentPlan.id}/assignees`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_ids: userIds })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not save assignments");
        close();
        document.dispatchEvent(new CustomEvent("planassignmentchange", { detail: payload }));
        if (window.__AI_HUB_PLAN__?.id === payload.id) window.location.reload();
      } catch (error) {
        const message = dialog.querySelector("#assignmentError");
        message.textContent = error.message;
        message.classList.remove("hidden");
      } finally { button.disabled = false; }
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !dialog.classList.contains("hidden")) close(); });
    lucide.createIcons();
    return dialog;
  }

  window.openPlanAssignment = async (plan) => {
    currentPlan = plan;
    returnFocus = document.activeElement;
    const surface = ensureDialog();
    surface.querySelector("#assignmentTitle").textContent = `#Seq ${plan.sequence_number} / #Shot ${plan.shot_number} · ${plan.title}`;
    surface.querySelector("#assignmentError").classList.add("hidden");
    surface.querySelector("#assignmentUsers").textContent = "Loading users…";
    surface.classList.remove("hidden");
    surface.classList.add("flex");
    surface.querySelector(".assignment-close").focus();
    try {
      const response = await fetch("/api/assignment-users");
      const users = await response.json();
      if (!response.ok) throw new Error(users.error || "Could not load users");
      const selected = new Set((plan.assignees || []).map((user) => user.id));
      surface.querySelector("#assignmentUsers").innerHTML = users.map((user) => `<label class="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 transition hover:border-acid/30"><input name="assignee" type="checkbox" value="${user.id}" class="h-4 w-4 accent-[#d6ff45]" ${selected.has(user.id) ? "checked" : ""} /><span class="min-w-0"><span class="block truncate text-sm text-zinc-200">${escapeHtml(user.display_name)}</span><span class="block text-[10px] text-zinc-600">@${escapeHtml(user.username)} · ${escapeHtml(user.role)}</span></span></label>`).join("") || `<p class="text-xs text-zinc-500">No active users are available.</p>`;
    } catch (error) {
      surface.querySelector("#assignmentUsers").textContent = error.message;
    }
  };

  document.querySelector("#assignPlanButton")?.addEventListener("click", () => window.openPlanAssignment(window.__AI_HUB_PLAN__));
})();
