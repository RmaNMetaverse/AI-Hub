/* global lucide */

(function () {
  if (window.location.pathname.endsWith("/login")) return;
  let button;
  let panel;
  let notifications = [];

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function render(payload) {
    notifications = payload.notifications || [];
    const badge = button.querySelector("#notificationBadge");
    badge.textContent = payload.unread_count > 99 ? "99+" : String(payload.unread_count || "");
    badge.classList.toggle("hidden", !payload.unread_count);
    panel.querySelector("#notificationList").innerHTML = notifications.length
      ? notifications.map((item) => `<button type="button" data-notification-id="${item.id}" class="notification-item block w-full border-b border-white/[0.06] p-3 text-left transition hover:bg-white/[0.05] ${item.read_at ? "text-zinc-500" : "bg-acid/[0.035] text-zinc-100"}"><span class="block text-xs leading-5">${escapeHtml(item.message)}</span><span class="mt-1 block text-[10px] text-zinc-600">${escapeHtml(item.created_at.replace("T", " ").slice(0, 16))}${item.plan_id ? " · Open plan" : ""}</span></button>`).join("")
      : `<div class="p-6 text-center text-xs text-zinc-500">No notifications yet.</div>`;
    panel.querySelectorAll(".notification-item").forEach((itemButton) => itemButton.addEventListener("click", async () => {
      const item = notifications.find((entry) => entry.id === Number(itemButton.dataset.notificationId));
      if (!item) return;
      await fetch(`/api/notifications/${item.id}/read`, { method: "PATCH" });
      if (item.plan_id) window.location.assign(`${window.__AI_HUB_BASE__ || ""}/plans/${item.plan_id}`);
      else await refresh();
    }));
  }

  async function refresh() {
    const response = await fetch("/api/notifications");
    if (response.ok) render(await response.json());
  }

  function init() {
    button = document.querySelector("#notificationButton");
    if (!button) {
      button = document.createElement("button");
      button.id = "notificationButton";
      button.type = "button";
      button.className = "icon-button fixed right-16 top-4 z-[75]";
      button.setAttribute("aria-label", "Notifications");
      button.innerHTML = `<i data-lucide="bell" class="h-4 w-4"></i><span id="notificationBadge" class="absolute -right-1 -top-1 hidden min-w-4 rounded-full bg-acid px-1 text-[9px] font-bold text-black"></span>`;
      document.body.append(button);
    }
    panel = document.createElement("div");
    panel.id = "notificationPanel";
    panel.className = "fixed right-3 top-[68px] z-[95] hidden max-h-[min(70vh,600px)] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-white/10 bg-[#151619] shadow-float";
    panel.innerHTML = `<div class="flex items-center justify-between border-b border-white/[0.07] p-4"><h2 class="text-sm font-semibold">Notifications</h2><button id="markNotificationsRead" type="button" class="text-[10px] text-acid hover:text-white">Mark all read</button></div><div id="notificationList" class="max-h-[min(60vh,500px)] overflow-y-auto"></div>`;
    document.body.append(panel);
    button.addEventListener("click", () => { panel.classList.toggle("hidden"); if (!panel.classList.contains("hidden")) void refresh(); });
    document.addEventListener("click", (event) => { if (!panel.contains(event.target) && !button.contains(event.target)) panel.classList.add("hidden"); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") panel.classList.add("hidden"); });
    panel.querySelector("#markNotificationsRead").addEventListener("click", async () => {
      const response = await fetch("/api/notifications/read-all", { method: "PATCH" });
      if (response.ok) render(await response.json());
    });
    lucide.createIcons();
    void refresh();
    window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
