const basePath = window.__AI_HUB_BASE__ || "";

document.querySelector(".workspace-mobile-menu")?.addEventListener("click", () => document.querySelector(".app-sidebar")?.classList.toggle("mobile-open"));
document.querySelector(".workspace-logout")?.addEventListener("click", async () => {
  await fetch(`${basePath}/auth/logout`, { method: "POST" });
  window.location.assign(`${basePath}/login`);
});

document.querySelector("#reportUserSearch")?.addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll("[data-report-user]").forEach((row) => row.classList.toggle("hidden", !row.dataset.reportUser.includes(query)));
});

const planBody = document.querySelector("#reportPlansBody");
const planSearch = document.querySelector("#reportPlanSearch");
const planSort = document.querySelector("#reportPlanSort");

function updatePlans() {
  const query = planSearch.value.trim().toLowerCase();
  const [field, direction] = planSort.value.split(":");
  const rows = [...planBody.querySelectorAll("[data-plan-row]")];
  rows.sort((left, right) => {
    const leftValue = left.dataset[field] || "";
    const rightValue = right.dataset[field] || "";
    const comparison = ["title", "updated_at"].includes(field)
      ? leftValue.localeCompare(rightValue)
      : Number(leftValue) - Number(rightValue);
    return direction === "asc" ? comparison : -comparison;
  });
  rows.forEach((row) => {
    row.classList.toggle("hidden", !row.dataset.search.includes(query));
    planBody.append(row);
  });
}

planSearch?.addEventListener("input", updatePlans);
planSort?.addEventListener("change", updatePlans);
updatePlans();
lucide.createIcons();
