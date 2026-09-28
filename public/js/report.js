const basePath = window.__AI_HUB_BASE__ || "";
const reportData = window.__REPORT_DATA__ || { charts: {}, users: [], plans: [] };
const chartColors = ["#d6ff45", "#70d6ff", "#ff70a6", "#ffca3a", "#9b8cff", "#58e6b0", "#ff8d5c", "#a1a1aa"];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);
const number = (value) => Number(value || 0);
const formatNumber = (value) => new Intl.NumberFormat(undefined, { notation: Math.abs(number(value)) >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(number(value));
const formatCost = (value) => `$${number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: number(value) < 0.01 && number(value) > 0 ? 4 : 2 })}`;

function emptyChart(target, message = "No data has been recorded yet") {
  if (!target) return;
  target.innerHTML = `<div class="report-chart-empty"><i data-lucide="chart-no-axes-column-increasing"></i><span>${escapeHtml(message)}</span></div>`;
}

function renderDonut(selector, rows, { valueKey = "value", centerLabel = "Total", formatter = formatNumber, legendFormatter = formatter } = {}) {
  const target = document.querySelector(selector);
  const data = (rows || []).map((row) => ({ ...row, value: number(row[valueKey]) })).filter((row) => row.value > 0);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  if (!target || !total) return emptyChart(target);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = data.map((row, index) => {
    const length = row.value / total * circumference;
    const segment = `<circle class="report-donut-segment" cx="50" cy="50" r="${radius}" fill="none" stroke="${chartColors[index % chartColors.length]}" stroke-width="12" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"><title>${escapeHtml(row.label)}: ${escapeHtml(legendFormatter(row.value, row))}</title></circle>`;
    offset += length;
    return segment;
  }).join("");
  const legend = data.map((row, index) => `<div class="report-legend-item"><span class="report-legend-dot" style="--legend-color:${chartColors[index % chartColors.length]}"></span><span class="report-legend-name" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><strong class="report-legend-value">${escapeHtml(legendFormatter(row.value, row))}</strong></div>`).join("");
  target.innerHTML = `<div class="report-donut-layout"><div class="report-donut-wrap"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${radius}" fill="none" stroke="rgba(255,255,255,.045)" stroke-width="12"/>${segments}</svg><div class="report-donut-center"><div class="report-donut-value">${escapeHtml(formatter(total))}</div><div class="report-donut-label">${escapeHtml(centerLabel)}</div></div></div><div class="report-chart-legend">${legend}</div></div>`;
}

function renderBars(selector, rows, { valueKey = "value", formatter = formatNumber, limit = 6, emptyMessage } = {}) {
  const target = document.querySelector(selector);
  const data = [...(rows || [])].map((row) => ({ ...row, value: number(row[valueKey]) })).sort((a, b) => b.value - a.value).slice(0, limit);
  const maximum = Math.max(...data.map((row) => row.value), 0);
  if (!target || !data.length || maximum <= 0) return emptyChart(target, emptyMessage);
  target.innerHTML = `<div class="report-bars">${data.map((row, index) => {
    const width = Math.max(3, row.value / maximum * 100);
    return `<div class="report-bar-row"><div class="report-bar-meta"><span class="report-bar-name" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><strong class="report-bar-value">${escapeHtml(formatter(row.value, row))}</strong></div><div class="report-bar-track"><div class="report-bar-fill" style="--bar-width:${width.toFixed(2)}%;--bar-color:${chartColors[index % chartColors.length]}"></div></div></div>`;
  }).join("")}</div>`;
}

function renderPulse(rows) {
  const target = document.querySelector("#productionPulseChart");
  if (!target || !(rows || []).length) return emptyChart(target);
  const data = rows.map((row) => ({ ...row, generations: number(row.generations), tokens: number(row.tokens), cost: number(row.cost), activities: number(row.activities) }));
  const width = 760;
  const height = 190;
  const plotTop = 12;
  const plotBottom = 155;
  const plotHeight = plotBottom - plotTop;
  const step = width / data.length;
  const barWidth = Math.min(24, step * 0.48);
  const maxTokens = Math.max(...data.map((row) => row.tokens), 1);
  const maxActivity = Math.max(...data.map((row) => row.activities), 1);
  const x = (index) => step * index + step / 2;
  const activityY = (value) => plotBottom - (value / maxActivity) * plotHeight;
  const linePoints = data.map((row, index) => `${x(index).toFixed(1)},${activityY(row.activities).toFixed(1)}`).join(" ");
  const areaPoints = `0,${plotBottom} ${linePoints} ${width},${plotBottom}`;
  const grid = [0, 0.5, 1].map((ratio) => `<line class="report-grid-line" x1="0" y1="${plotTop + plotHeight * ratio}" x2="${width}" y2="${plotTop + plotHeight * ratio}"/>`).join("");
  const bars = data.map((row, index) => {
    const barHeight = row.tokens / maxTokens * plotHeight;
    return `<rect class="report-pulse-bar" x="${(x(index) - barWidth / 2).toFixed(1)}" y="${(plotBottom - barHeight).toFixed(1)}" width="${barWidth}" height="${Math.max(barHeight, row.tokens ? 2 : 0).toFixed(1)}" rx="${Math.min(6, barWidth / 2)}"><title>${escapeHtml(row.day)} · ${formatNumber(row.tokens)} credits · ${row.generations} generations · ${row.activities} activities · ${formatCost(row.cost)}</title></rect>`;
  }).join("");
  const dots = data.map((row, index) => `<circle class="report-pulse-dot" cx="${x(index).toFixed(1)}" cy="${activityY(row.activities).toFixed(1)}" r="3"><title>${escapeHtml(row.day)}: ${row.activities} activities</title></circle>`).join("");
  const labels = data.map((row, index) => index % 2 === 0 || index === data.length - 1 ? `<text class="report-axis-label" x="${x(index).toFixed(1)}" y="177" text-anchor="middle">${escapeHtml(new Date(`${row.day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</text>` : "").join("");
  const totals = data.reduce((sum, row) => ({ generations: sum.generations + row.generations, tokens: sum.tokens + row.tokens, cost: sum.cost + row.cost, activities: sum.activities + row.activities }), { generations: 0, tokens: 0, cost: 0, activities: 0 });
  target.innerHTML = `<div class="report-pulse-shell"><div class="report-pulse-stats"><div class="report-pulse-stat"><span>Generations</span><strong>${formatNumber(totals.generations)}</strong></div><div class="report-pulse-stat"><span>Credits</span><strong>${formatNumber(totals.tokens)}</strong></div><div class="report-pulse-stat"><span>Cost</span><strong>${formatCost(totals.cost)}</strong></div><div class="report-pulse-stat"><span>Activity</span><strong>${formatNumber(totals.activities)}</strong></div><div class="report-pulse-stat"><span>Chart</span><strong><span style="color:#70d6ff">Bars</span> credits · <span style="color:#d6ff45">Line</span> activity</strong></div></div><svg class="report-pulse-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="reportBarGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#70d6ff" stop-opacity=".9"/><stop offset="1" stop-color="#70d6ff" stop-opacity=".12"/></linearGradient><linearGradient id="reportAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6ff45" stop-opacity=".16"/><stop offset="1" stop-color="#d6ff45" stop-opacity="0"/></linearGradient></defs>${grid}<polygon class="report-pulse-area" points="${areaPoints}"/>${bars}<polyline class="report-pulse-line" points="${linePoints}"/>${dots}${labels}</svg></div>`;
}

function renderCharts() {
  const charts = reportData.charts || {};
  renderPulse(charts.dailyPulse);
  renderDonut("#planStatusChart", charts.planStatuses, { centerLabel: "Plans" });
  renderDonut("#platformCreditsChart", charts.platforms, { valueKey: "token_count", centerLabel: "Credits", legendFormatter: (value, row) => `${formatNumber(value)} · ${formatCost(row.generation_cost)}` });
  renderDonut("#generationStatusChart", charts.generationStatuses, { centerLabel: "Results" });
  renderBars("#userActivityChart", (reportData.users || []).map((user) => ({ label: user.display_name, value: user.activity_count })), { emptyMessage: "User activity will appear here" });
  renderBars("#planCostChart", (reportData.plans || []).map((plan) => ({ label: `#${plan.sequence_number}/${plan.shot_number} · ${plan.title}`, value: plan.generation_cost })), { formatter: formatCost, emptyMessage: "Add generation costs to compare plans" });
  renderBars("#activityTypeChart", charts.activityTypes, { limit: 7, emptyMessage: "Activity categories will appear here" });
}

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
renderCharts();
lucide.createIcons();
