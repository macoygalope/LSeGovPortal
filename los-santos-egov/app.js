document.addEventListener("DOMContentLoaded", async () => {
  Egov.initNavigation();
  const data = await Egov.loadAll();
  const settings = Egov.applySettings(data.SiteSettings);

  renderForms(data.Forms, settings);
  renderAnnouncements(data.Announcements, settings);
  renderHomepageDocuments(data.ExecutiveOrders, "ExecutiveOrders", "executiveGrid", settings);
  renderHomepageDocuments(data.Memorandums, "Memorandums", "memorandumGrid", settings);
  renderHomepageDocuments(data.Resolutions, "Resolutions", "resolutionGrid", settings);
  renderStats(data);

  Egov.initViewer(data, settings);
  Egov.attachPlaceholderHandlers();
});

function renderForms(items, settings) {
  const grid = document.getElementById("formsGrid");
  const visible = Egov.published(items);

  if (!visible.length) {
    grid.innerHTML = `<div class="empty-state">Wala pang pampublikong form na maaaring buksan.</div>`;
    return;
  }

  grid.innerHTML = visible.map((item) => `
    <a class="form-card" ${Egov.linkAttributes(item.url)}>
      ${Egov.cardMedia(item, "", "📄")}
      <div class="form-card-body">
        <h3>${Egov.escapeHtml(item.title)}</h3>
        <p>${Egov.escapeHtml(item.description || "Buksan ang opisyal na online form.")}</p>
        <span class="card-link">Buksan ang Form ↗</span>
      </div>
    </a>
  `).join("");
}

function renderAnnouncements(items) {
  const list = document.getElementById("announcementList");
  const visible = Egov.newest(items).slice(0, 4);

  if (!visible.length) {
    list.innerHTML = `<div class="empty-state">Wala pang anunsyong nailalathala.</div>`;
    return;
  }

  list.innerHTML = visible.map((item) => {
    const parts = Egov.dateParts(item.date);
    const image = Egov.imageUrl(item.image);
    return `
      <article class="announcement-card ${image ? "has-image" : ""}">
        ${image ? `<img class="announcement-image" src="${Egov.escapeHtml(image)}" alt="" loading="lazy">` : ""}
        <div class="announcement-date">
          <div>
            <strong>${parts.day}</strong>
            <span>${parts.month} ${parts.year}</span>
          </div>
        </div>
        <div class="announcement-copy">
          <h3>${Egov.escapeHtml(item.title)}</h3>
          <p>${Egov.escapeHtml(item.description || "")}</p>
        </div>
        ${Egov.safeUrl(item.url) !== "#"
          ? `<a class="button button-secondary button-small" ${Egov.linkAttributes(item.url)}>Basahin Pa</a>`
          : ""}
      </article>
    `;
  }).join("");
}

function renderHomepageDocuments(items, section, targetId, settings) {
  const target = document.getElementById(targetId);
  const visible = Egov.newest(items).slice(0, 3);

  if (!visible.length) {
    target.innerHTML = `<div class="empty-state">${Egov.labels[section].empty}</div>`;
    return;
  }

  target.innerHTML = Egov.renderDocumentCards(visible, section, settings.defaultDocumentImageUrl);
}

function renderStats(data) {
  document.getElementById("formsCount").textContent = Egov.published(data.Forms).length;
  document.getElementById("announcementCount").textContent = Egov.published(data.Announcements).length;
  document.getElementById("ordersCount").textContent = Egov.published(data.ExecutiveOrders).length;
  document.getElementById("documentsCount").textContent =
    Egov.published(data.Memorandums).length + Egov.published(data.Resolutions).length;
}
