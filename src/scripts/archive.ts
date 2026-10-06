// Search, sort and pagination for an archive page. Every card is already in
// the HTML (see pages/[section]/index.astro); this only decides which are
// visible and in what order. Sort positions are precomputed at build time as
// data-rank-<mode>, so there is no sorting logic to keep in sync here.

const root = document.querySelector<HTMLElement>("[data-archive]");

if (root) {
  const grid = root.querySelector<HTMLElement>("[data-archive-grid]")!;
  const pagination = root.querySelector<HTMLElement>("[data-archive-pagination]")!;
  const emptyState = root.querySelector<HTMLElement>("[data-archive-empty]")!;
  const search = root.querySelector<HTMLInputElement>("#archiveSearch")!;
  const sortControl = root.querySelector<HTMLSelectElement>("#archiveSort");
  const count = root.querySelector<HTMLElement>("#archiveCount")!;
  const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-card]"));

  const pageSize = Number(root.dataset.pageSize) || 9;
  const { countSingular = "", countPlural = "", searchEmpty = "" } = root.dataset;
  const SORT_MODES = ["newest", "oldest", "numberAsc", "numberDesc"];

  const params = new URLSearchParams(window.location.search);
  let page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
  let sortMode = sortControl && SORT_MODES.includes(params.get("sort") ?? "") ? params.get("sort")! : "newest";
  let query = "";

  if (sortControl) sortControl.value = sortMode;

  const rank = (card: HTMLElement) => Number(card.getAttribute(`data-rank-${sortMode.toLowerCase()}`));

  function pageNumbers(current: number, total: number): (number | "…")[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | "…")[] = [1];
    if (current > 4) pages.push("…");
    for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p += 1) pages.push(p);
    if (current < total - 3) pages.push("…");
    pages.push(total);
    return pages;
  }

  function renderPagination(totalPages: number) {
    pagination.replaceChildren();
    if (totalPages <= 1) return;

    const button = (text: string, target: number, opts: { disabled?: boolean; active?: boolean } = {}) => {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = text;
      el.dataset.page = String(target);
      el.disabled = Boolean(opts.disabled);
      if (opts.active) el.className = "active";
      return el;
    };

    pagination.append(button("← Nauna", page - 1, { disabled: page === 1 }));
    for (const p of pageNumbers(page, totalPages)) {
      if (p === "…") {
        const gap = document.createElement("span");
        gap.className = "pagination-ellipsis";
        gap.textContent = "…";
        pagination.append(gap);
      } else {
        pagination.append(button(String(p), p, { active: p === page }));
      }
    }
    pagination.append(button("Susunod →", page + 1, { disabled: page === totalPages }));
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    if (page <= 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(page));
    if (sortMode === "newest") url.searchParams.delete("sort");
    else url.searchParams.set("sort", sortMode);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function render() {
    const needle = query.trim().toLowerCase();
    const ordered = [...cards].sort((a, b) => rank(a) - rank(b));
    const matches = needle ? ordered.filter((card) => (card.dataset.search ?? "").includes(needle)) : ordered;

    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
    page = Math.min(Math.max(page, 1), totalPages);
    const visible = new Set(matches.slice((page - 1) * pageSize, page * pageSize));

    // Re-appending in order moves the nodes, which is how sorting is applied.
    for (const card of ordered) {
      card.classList.toggle("hidden", !visible.has(card));
      grid.insertBefore(card, emptyState);
    }

    count.textContent = `${matches.length} ${matches.length === 1 ? countSingular : countPlural}`;
    emptyState.textContent = searchEmpty;
    emptyState.classList.toggle("hidden", matches.length > 0);
    renderPagination(totalPages);
    syncUrl();
  }

  pagination.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-page]");
    if (!target || target.disabled) return;
    page = Number(target.dataset.page);
    render();
    root.querySelector(".archive-toolbar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  search.addEventListener("input", () => {
    query = search.value;
    page = 1;
    render();
  });

  sortControl?.addEventListener("change", () => {
    sortMode = sortControl.value;
    page = 1;
    render();
  });

  render();
}
