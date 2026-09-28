const basePath = window.__AI_HUB_BASE__ || "";

document.querySelector(".workspace-mobile-menu")?.addEventListener("click", () => document.querySelector(".app-sidebar")?.classList.toggle("mobile-open"));
document.querySelector(".workspace-logout")?.addEventListener("click", async () => {
  await fetch(`${basePath}/auth/logout`, { method: "POST" });
  window.location.assign(`${basePath}/login`);
});

function filterActivity() {
  const query = document.querySelector("#activitySearch").value.trim().toLowerCase();
  const role = document.querySelector("#activityRoleFilter").value;
  const type = document.querySelector("#activityTypeFilter").value;
  let visible = 0;
  document.querySelectorAll("[data-activity]").forEach((item) => {
    const matches = item.dataset.search.includes(query)
      && (role === "all" || item.dataset.role === role)
      && (type === "all" || item.dataset.type === type);
    item.classList.toggle("hidden", !matches);
    if (matches) visible += 1;
  });
  document.querySelector("#activityEmpty")?.classList.toggle("hidden", visible > 0);
}

for (const id of ["activitySearch", "activityRoleFilter", "activityTypeFilter"]) {
  document.querySelector(`#${id}`)?.addEventListener(id === "activitySearch" ? "input" : "change", filterActivity);
}
lucide.createIcons();
