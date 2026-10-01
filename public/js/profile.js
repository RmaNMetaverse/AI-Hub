(() => {
  const base = window.__AI_HUB_BASE__ || "";
  if (window.location.pathname === `${base}/login`) return;
  for (const menu of document.querySelectorAll("#accountMenu, #shotAccountMenu")) {
    const link = document.createElement("a");
    link.href = `${base}/profile`;
    link.className = "nav-item";
    link.textContent = "My profile";
    menu.insertBefore(link, menu.children[1] || null);
  }
  for (const logout of document.querySelectorAll(".library-logout")) {
    const link = document.createElement("a");
    link.href = `${base}/profile`;
    link.className = "nav-item mt-3";
    link.textContent = "My profile";
    logout.before(link);
  }
  function showAvatar(url) {
    if (!url) return;
    for (const target of document.querySelectorAll("#accountButton, #shotAccountButton, #profileAvatar")) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "Your profile picture";
      image.className = "h-full w-full object-contain";
      target.style.background = "transparent";
      image.style.filter = "none";
      image.style.mixBlendMode = "normal";
      image.style.opacity = "1";
      target.replaceChildren(image);
    }
  }
  fetch("/api/profile").then((response) => response.ok ? response.json() : null).then((profile) => showAvatar(profile?.avatar_url)).catch(() => {});
  const message = document.querySelector("#profileMessage");
  for (const [selector, endpoint, success] of [["#profileAvatarForm", "/api/profile/avatar", "Profile picture saved"], ["#profilePasswordForm", "/api/profile/password", "Password changed"]]) {
    const form = document.querySelector(selector);
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      message.textContent = "Saving…";
      try {
        const data = new FormData(form);
        const isAvatar = selector === "#profileAvatarForm";
        if (isAvatar && data.get("file").size > 5 * 1024 * 1024) throw new Error("Avatar must be under 5 MB");
        const response = await fetch(endpoint, { method: "POST", ...(isAvatar ? { body: data } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not save changes");
        showAvatar(payload.avatar_url);
        form.reset();
        message.textContent = success;
      } catch (error) { message.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
})();
