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

const resourceUploadForm = document.querySelector("#resourceUploadForm");
const resourceDropZone = document.querySelector("#resourceDropZone");
const resourceFileInput = document.querySelector("#resourceFileInput");
const resourceUploadQueue = document.querySelector("#resourceUploadQueue");

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function uploadResource(file, category, notes, row) {
  return new Promise((resolve, reject) => {
    const progressBar = row.querySelector("[data-upload-progress]");
    const progressLabel = row.querySelector("[data-upload-label]");
    const payload = new FormData();
    payload.append("category", category);
    payload.append("notes", notes);
    payload.append("file", file, file.name);

    const request = new XMLHttpRequest();
    request.open("POST", `/api/plans/${plan.id}/resources`);
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percentage = Math.min(100, Math.round((event.loaded / event.total) * 100));
      progressBar.style.width = `${percentage}%`;
      progressLabel.textContent = percentage === 100 ? "Processing…" : `${percentage}%`;
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        progressBar.style.width = "100%";
        progressLabel.textContent = "Saved";
        progressLabel.classList.add("text-acid");
        resolve(request.response);
      } else {
        reject(new Error(request.response?.error || "Upload failed"));
      }
    });
    request.addEventListener("error", () => reject(new Error("The connection was interrupted")));
    request.send(payload);
  });
}

function uploadQueueRow(file) {
  const row = document.createElement("div");
  row.className = "rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5";
  const heading = document.createElement("div");
  heading.className = "flex items-center justify-between gap-3 text-[10px]";
  const filename = document.createElement("span");
  filename.className = "min-w-0 truncate font-medium text-zinc-400";
  filename.textContent = file.name;
  const status = document.createElement("span");
  status.className = "shrink-0 text-zinc-600";
  status.dataset.uploadLabel = "";
  status.textContent = formatBytes(file.size);
  heading.append(filename, status);
  const track = document.createElement("div");
  track.className = "mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]";
  const progress = document.createElement("div");
  progress.className = "h-full w-0 rounded-full bg-acid transition-[width]";
  progress.dataset.uploadProgress = "";
  track.append(progress);
  row.append(heading, track);
  return row;
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length || !resourceUploadForm) return;
  const maxBytes = Number(resourceUploadForm.dataset.maxUploadBytes);
  const oversized = files.find((file) => file.size > maxBytes);
  if (oversized) return showToast(`${oversized.name} is larger than ${formatBytes(maxBytes)}`);

  resourceUploadQueue.replaceChildren();
  resourceUploadQueue.classList.remove("hidden");
  const category = document.querySelector("#resourceCategory").value;
  const notes = document.querySelector("#resourceNotes").value.trim();
  let uploaded = 0;

  for (const file of files) {
    const row = uploadQueueRow(file);
    resourceUploadQueue.append(row);
    try {
      await uploadResource(file, category, notes, row);
      uploaded += 1;
    } catch (error) {
      const label = row.querySelector("[data-upload-label]");
      label.textContent = error.message;
      label.classList.add("text-red-300");
      row.querySelector("[data-upload-progress]").classList.replace("bg-acid", "bg-red-400");
    }
  }

  if (uploaded) {
    showToast(`${uploaded} resource${uploaded === 1 ? "" : "s"} uploaded`);
    window.location.hash = "resources";
    setTimeout(() => window.location.reload(), 650);
  } else {
    showToast("No resources were uploaded");
  }
}

resourceUploadForm?.addEventListener("submit", (event) => event.preventDefault());
resourceDropZone?.addEventListener("click", (event) => {
  if (event.target !== resourceFileInput) resourceFileInput.click();
});
resourceDropZone?.addEventListener("keydown", (event) => {
  if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    resourceFileInput.click();
  }
});
resourceFileInput?.addEventListener("change", () => {
  uploadFiles(resourceFileInput.files);
  resourceFileInput.value = "";
});

for (const eventName of ["dragenter", "dragover"]) {
  resourceDropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    resourceDropZone.classList.add("border-acid/50", "bg-acid/[0.04]");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  resourceDropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    resourceDropZone.classList.remove("border-acid/50", "bg-acid/[0.04]");
  });
}
resourceDropZone?.addEventListener("drop", (event) => uploadFiles(event.dataTransfer.files));

document.querySelector("#resourceFilter")?.addEventListener("change", (event) => {
  document.querySelectorAll("[data-resource-card]").forEach((card) => {
    card.classList.toggle("hidden", event.target.value !== "all" && card.dataset.resourceCategory !== event.target.value);
  });
});

document.querySelectorAll(".resource-delete-button").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!window.confirm(`Remove ${button.dataset.resourceName} from this shot?`)) return;
    button.disabled = true;
    const response = await fetch(`/api/resources/${button.dataset.resourceId}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      button.disabled = false;
      return showToast(payload.error || "Could not remove this resource");
    }
    showToast("Resource removed");
    window.location.hash = "resources";
    setTimeout(() => window.location.reload(), 450);
  });
});

const initialTab = window.location.hash.slice(1);
if (["overview", "resources", "generations", "prompt", "notes"].includes(initialTab)) activateTab(initialTab);
lucide.createIcons();
