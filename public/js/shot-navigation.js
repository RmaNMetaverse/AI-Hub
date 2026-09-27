(() => {
  const form = document.querySelector("#shotNavigationForm");
  if (!form) return;
  const sequence = form.elements.sequence_number;
  const shot = form.elements.shot_number;
  const results = document.querySelector("#shotNavigationResults");
  const detailPlans = window.__AI_HUB_NAVIGATION_PLANS__;
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--shot-navigation-height", `${form.getBoundingClientRect().height}px`);
  }).observe(form);
  const params = () => {
    const values = new URLSearchParams();
    for (const field of [sequence, shot]) if (field.value) values.set(field.name, field.value);
    return values;
  };
  const matches = (plan) => form.checkValidity()
    && (!sequence.value || plan.sequence_number === Number(sequence.value))
    && (!shot.value || plan.shot_number === Number(shot.value));
  window.shotNavigation = { matches, query: () => params().toString() };
  function update() {
    const url = new URL(window.location.href);
    for (const field of [sequence, shot]) {
      if (field.value) url.searchParams.set(field.name, field.value);
      else url.searchParams.delete(field.name);
    }
    window.history.replaceState({}, "", url);
    if (detailPlans) {
      results.replaceChildren();
      results.classList.toggle("hidden", !sequence.value && !shot.value);
      const plans = detailPlans.filter(matches);
      const count = document.createElement("p");
      count.className = "text-xs text-zinc-400";
      count.textContent = form.checkValidity() ? `${plans.length} matching shot${plans.length === 1 ? "" : "s"}` : "Enter whole numbers from 1 to 1,000,000.";
      results.append(count);
      for (const plan of plans.slice(0, 6)) {
        const link = document.createElement("a");
        const query = params().toString();
        link.href = `/plans/${plan.id}${query ? `?${query}` : ""}`;
        link.className = "mr-3 mt-2 inline-block rounded-lg border border-white/10 px-3 py-2 text-xs text-acid hover:bg-white/5";
        link.textContent = `#Seq ${plan.sequence_number} · #Shot ${plan.shot_number} · ${plan.title}`;
        results.append(link);
      }
      // Keep back/previous/next navigation inside the current number filters.
      for (const link of document.querySelectorAll("a[data-shot-navigation]")) {
        const target = new URL(link.href);
        target.search = params().toString();
        link.href = target.href;
      }
      const currentIndex = plans.findIndex((plan) => plan.id === window.__AI_HUB_PLAN__.id);
      for (const [id, offset] of [["previousShot", -1], ["nextShot", 1]]) {
        const link = document.querySelector(`#${id}`);
        const target = currentIndex < 0 ? null : plans[currentIndex + offset];
        if (!link) continue;
        link.classList.toggle("hidden", !target);
        const query = params().toString();
        if (target) link.href = `/plans/${target.id}${query ? `?${query}` : ""}`;
      }
    }
    document.dispatchEvent(new CustomEvent("shotfilterschange"));
  }
  form.addEventListener("input", update);
  form.addEventListener("submit", (event) => {
    if (!detailPlans) { event.preventDefault(); update(); }
  });
  document.querySelector("#clearShotFilters").addEventListener("click", () => {
    sequence.value = ""; shot.value = ""; update(); sequence.focus();
  });
  window.addEventListener("popstate", () => {
    const values = new URLSearchParams(window.location.search);
    sequence.value = values.get("sequence_number") || "";
    shot.value = values.get("shot_number") || "";
    update();
  });
  update();
})();
