/* global lucide */

const steps = {
  identify: document.querySelector("#identifyStep"),
  password: document.querySelector("#passwordStep"),
  setup: document.querySelector("#setupStep")
};
const errorBox = document.querySelector("#authError");
let account = null;

function initials(name) {
  return String(name || "").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function showStep(name) {
  Object.entries(steps).forEach(([key, element]) => element.classList.toggle("hidden", key !== name));
  hideError();
  const focusTarget = name === "identify" ? "#usernameInput" : name === "password" ? "#passwordInput" : "#newPasswordInput";
  setTimeout(() => document.querySelector(focusTarget)?.focus(), 50);
}

function showError(message) {
  errorBox.querySelector("span").textContent = message;
  errorBox.classList.remove("hidden");
  errorBox.classList.add("flex");
}

function hideError() {
  errorBox.classList.add("hidden");
  errorBox.classList.remove("flex");
}

function setSubmitting(form, submitting, label) {
  const button = form.querySelector("button[type='submit']");
  button.disabled = submitting;
  button.classList.toggle("opacity-60", submitting);
  button.querySelector("span").textContent = submitting ? "Please wait..." : label;
}

async function send(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(payload.error || "Something went wrong");
  return payload;
}

document.querySelector("#identifyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  const form = event.currentTarget;
  setSubmitting(form, true, "Continue");
  try {
    account = await send("/auth/identify", { username: form.elements.username.value });
    if (account.setupRequired) {
      document.querySelector("#setupName").textContent = account.displayName;
      showStep("setup");
    } else {
      document.querySelector("#passwordName").textContent = account.displayName;
      document.querySelector("#passwordRole").textContent = `${account.role} · @${account.username}`;
      document.querySelector("#passwordAvatar").textContent = initials(account.displayName);
      showStep("password");
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setSubmitting(form, false, "Continue");
  }
});

document.querySelector("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  const form = event.currentTarget;
  setSubmitting(form, true, "Sign in");
  try {
    await send("/auth/login", { username: account.username, password: form.elements.password.value });
    window.location.assign("/");
  } catch (error) {
    showError(error.message);
    setSubmitting(form, false, "Sign in");
  }
});

document.querySelector("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  const form = event.currentTarget;
  setSubmitting(form, true, "Create password & sign in");
  try {
    await send("/auth/activate", {
      username: account.username,
      password: form.elements.password.value,
      confirmation: form.elements.confirmation.value
    });
    window.location.assign("/");
  } catch (error) {
    showError(error.message);
    setSubmitting(form, false, "Create password & sign in");
  }
});

document.querySelectorAll(".back-button").forEach((button) => button.addEventListener("click", () => {
  account = null;
  document.querySelector("#passwordForm").reset();
  document.querySelector("#setupForm").reset();
  showStep("identify");
}));

document.querySelectorAll(".password-toggle").forEach((button) => button.addEventListener("click", () => {
  const input = button.parentElement.querySelector("input");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  button.innerHTML = `<i data-lucide="${show ? "eye-off" : "eye"}" class="h-4 w-4"></i>`;
  lucide.createIcons();
}));

lucide.createIcons();
