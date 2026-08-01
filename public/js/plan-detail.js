/* global lucide */

const plan = window.__AI_HUB_PLAN__;
const toast = document.querySelector("#shotToast");

function showToast(message) {
  toast.querySelector("span").textContent = message;
  toast.classList.remove("translate-y-4", "opacity-0");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("translate-y-4", "opacity-0"), 2200);
}

function activateTab(name) {
  document.querySelectorAll(".shot-tab").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.classList.toggle("text-zinc-600", !active);
  });
  document.querySelectorAll(".shot-panel").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== name));
  window.history.replaceState(null, "", `#${name}`);
  window.scrollTo({ top: document.querySelector(".shot-tab").getBoundingClientRect().top + window.scrollY - 84, behavior: "smooth" });
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

document.querySelector("#shotStatusSelect")?.addEventListener("change", (event) => updateStatus(event.target.value));
document.querySelector("#approveShotButton")?.addEventListener("click", () => updateStatus("Approved"));

document.querySelector("#copyPromptButton")?.addEventListener("click", async () => {
  await navigator.clipboard.writeText(plan.prompt || "");
  showToast("Prompt copied");
});

document.querySelector("#copyShotLink")?.addEventListener("click", async () => {
  await navigator.clipboard.writeText(window.location.href.split("#")[0]);
  showToast("Shot link copied");
});

const accountButton = document.querySelector("#shotAccountButton");
const accountMenu = document.querySelector("#shotAccountMenu");
accountButton?.addEventListener("click", (event) => { event.stopPropagation(); accountMenu.classList.toggle("hidden"); });
document.addEventListener("click", (event) => {
  if (accountMenu && !accountMenu.contains(event.target) && !accountButton.contains(event.target)) accountMenu.classList.add("hidden");
});
document.querySelector("#shotLogoutButton")?.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  window.location.assign("/login");
});

const initialTab = window.location.hash.slice(1);
if (["overview", "generations", "prompt", "notes"].includes(initialTab)) activateTab(initialTab);
lucide.createIcons();
