document.addEventListener("DOMContentLoaded", async () => {
  Egov.initNavigation();

  const section = document.body.dataset.documentSection;
  const data = await Egov.loadAll();
  const settings = Egov.applySettings(data.SiteSettings);

  const grid = document.getElementById("archiveGrid");
  const search = document.getElementById("archiveSearch");
  const sortControl = document.getElementById("archiveSort");
  const pagination = document.getElementById("pagination");
  const count = document.getElementById("archiveCount");
  const pageSize = 9;
  const sectionLabel = Egov.labels[section] || {
    searchEmpty: "Walang record na tumutugma sa iyong paghahanap.",
    countSingular: "record",
    countPlural: "mga record"
  };
  let currentPage = getPageFromUrl();
  let query = "";
  let sortMode = getSortFromUrl();

  if (sortControl) sortControl.value = sortMode;

  function orderedItems() {
    if (section === "Announcements") return Egov.orderedAnnouncements(data[section]);
    return Egov.sortDocuments(data[section], sortMode);
  }

  function filteredItems() {
    const normalized = query.trim().toLowerCase();
    const items = orderedItems();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.title} ${item.description} ${item.number} ${item.content || ""}`.toLowerCase().includes(normalized)
    );
  }

  function render() {
    const filtered = filteredItems();
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    const start = (currentPage - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    count.textContent = `${filtered.length} ${filtered.length === 1 ? sectionLabel.countSingular : sectionLabel.countPlural}`;

    if (!pageItems.length) {
      grid.innerHTML = `<div class="empty-state">${sectionLabel.searchEmpty}</div>`;
    } else {
      grid.innerHTML = Egov.renderDocumentCards(pageItems, section, settings.defaultDocumentImageUrl);
    }

    renderPagination(totalPages);
    Egov.attachPlaceholderHandlers();
  }

  function renderPagination(totalPages) {
    if (totalPages <= 1) {
      pagination.innerHTML = "";
      return;
    }

    const pages = buildPageNumbers(currentPage, totalPages);
    pagination.innerHTML = `
      <button type="button" ${currentPage === 1 ? "disabled" : ""} data-page="${currentPage - 1}">← Nauna</button>
      ${pages.map((page) =>
        page === "…"
          ? `<span class="pagination-ellipsis">…</span>`
          : `<button type="button" class="${page === currentPage ? "active" : ""}" data-page="${page}">${page}</button>`
      ).join("")}
      <button type="button" ${currentPage === totalPages ? "disabled" : ""} data-page="${currentPage + 1}">Susunod →</button>
    `;
  }

  pagination.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    currentPage = Number(button.dataset.page);
    setArchiveUrl(currentPage, sortMode);
    render();
    document.querySelector(".archive-toolbar").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  search.addEventListener("input", () => {
    query = search.value;
    currentPage = 1;
    setArchiveUrl(1, sortMode);
    render();
  });

  if (sortControl) {
    sortControl.addEventListener("change", () => {
      sortMode = sortControl.value;
      currentPage = 1;
      setArchiveUrl(1, sortMode);
      render();
    });
  }

  Egov.initViewer(data, settings);
  render();
});

function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = [1];
  if (current > 4) pages.push("…");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let page = start; page <= end; page += 1) pages.push(page);

  if (current < total - 3) pages.push("…");
  pages.push(total);
  return pages;
}

function getPageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get("page") || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function getSortFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("sort") || "newest";
  return ["newest", "oldest", "numberAsc", "numberDesc"].includes(value) ? value : "newest";
}

function setArchiveUrl(page, sortMode) {
  const url = new URL(window.location.href);
  if (page <= 1) url.searchParams.delete("page");
  else url.searchParams.set("page", String(page));

  if (!sortMode || sortMode === "newest") url.searchParams.delete("sort");
  else url.searchParams.set("sort", sortMode);

  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
