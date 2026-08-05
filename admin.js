const CONFIG = window.EGOV_CONFIG || {};
const API_URL = CONFIG.API_URL || "";

const SECTION_NAMES = {
  Forms: "Mga Form",
  Announcements: "Mga Anunsyo",
  ExecutiveOrders: "Executive Orders",
  Memorandums: "Mga Memorandum",
  Resolutions: "Mga Resolusyon",
  Settings: "Mga Larawan at Ayos"
};

const INTERNAL_DOCUMENT_SECTIONS = new Set(["Announcements", "ExecutiveOrders", "Memorandums", "Resolutions"]);
const CONTENT_CHUNK_SIZE = 1050;

let activeSection = "Forms";
let records = [];
let adminToken = sessionStorage.getItem("egovAdminToken") || "";

const loginPanel = document.getElementById("loginPanel");
const dashboard = document.getElementById("dashboard");
const entryEditor = document.getElementById("entryEditor");
const recordsPanel = document.getElementById("recordsPanel");
const settingsEditor = document.getElementById("settingsEditor");
const entryForm = document.getElementById("entryForm");
const settingsForm = document.getElementById("settingsForm");
const recordsList = document.getElementById("recordsList");

function isConfigured() {
  return API_URL && !API_URL.includes("PASTE_YOUR");
}

function jsonp(params, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      reject(new Error("Ilagay muna ang Apps Script URL sa config.js."));
      return;
    }

    const callbackName = `egovAdminCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Masyadong matagal ang tugon ng backend."));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (!payload || payload.ok === false) reject(new Error(payload?.error || "Hindi naisagawa ang kahilingan."));
      else resolve(payload);
    };

    const query = new URLSearchParams({
      ...params,
      token: adminToken,
      callback: callbackName,
      _: Date.now().toString()
    });

    script.src = `${API_URL}?${query.toString()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("Hindi makakonekta sa Google Apps Script."));
    };
    document.body.appendChild(script);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 4000);
}

function replaceDocumentSelection(replacement, selectFrom = null, selectTo = null) {
  const textarea = document.getElementById("contentInput");
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);

  textarea.value = `${before}${replacement}${after}`;
  textarea.focus();

  const nextStart = start + (selectFrom === null ? replacement.length : selectFrom);
  const nextEnd = start + (selectTo === null ? nextStart - start : selectTo);
  textarea.setSelectionRange(nextStart, nextEnd);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function transformSelectedLines(transformer, fallbackText) {
  const textarea = document.getElementById("contentInput");
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  const source = selected || fallbackText;
  const transformed = source
    .split("\n")
    .map((line, index) => line.trim() ? transformer(line, index) : line)
    .join("\n");

  replaceDocumentSelection(transformed, 0, transformed.length);
}

function applyDocumentFormatting(command) {
  const textarea = document.getElementById("contentInput");
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);

  if (command === "bold" || command === "italic") {
    const marker = command === "bold" ? "**" : "*";
    const placeholder = command === "bold" ? "makapal na teksto" : "pahilis na teksto";
    const content = selected || placeholder;
    const replacement = `${marker}${content}${marker}`;
    replaceDocumentSelection(replacement, marker.length, marker.length + content.length);
    return;
  }

  if (command === "heading") {
    transformSelectedLines((line) => `## ${line.replace(/^#{1,3}\s+/, "")}`, "Pamagat ng Seksyon");
    return;
  }

  if (command === "bullet") {
    transformSelectedLines((line) => `- ${line.replace(/^\s*[-+]\s+/, "")}`, "Unang item\nIkalawang item");
    return;
  }

  if (command === "numbered") {
    transformSelectedLines(
      (line, index) => `${index + 1}. ${line.replace(/^\s*\d+[.)]\s+/, "")}`,
      "Unang item\nIkalawang item"
    );
    return;
  }

  if (command === "quote") {
    transformSelectedLines((line) => `> ${line.replace(/^\s*>\s?/, "")}`, "Siping pahayag");
    return;
  }

  if (command === "divider") {
    const beforeNeedsBreak = start > 0 && !textarea.value.slice(0, start).endsWith("\n\n");
    const afterNeedsBreak = end < textarea.value.length && !textarea.value.slice(end).startsWith("\n\n");
    const replacement = `${beforeNeedsBreak ? "\n\n" : ""}---${afterNeedsBreak ? "\n\n" : ""}`;
    replaceDocumentSelection(replacement);
  }
}

function showDashboard() {
  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

function showLogin() {
  loginPanel.classList.remove("hidden");
  dashboard.classList.add("hidden");
}

async function validateLogin() {
  try {
    await jsonp({ action: "auth" });
    sessionStorage.setItem("egovAdminToken", adminToken);
    showDashboard();
    await loadRecords();
  } catch (error) {
    adminToken = "";
    sessionStorage.removeItem("egovAdminToken");
    showLogin();
    showToast(error.message);
  }
}

function configureEntryFields() {
  const hasInternalPage = INTERNAL_DOCUMENT_SECTIONS.has(activeSection);
  const isForm = activeSection === "Forms";
  const isAnnouncement = activeSection === "Announcements";

  document.getElementById("contentFieldGroup").classList.toggle("hidden", !hasInternalPage);
  document.getElementById("numberInput").closest("label").classList.toggle("field-muted", isForm);
  document.getElementById("contentFieldLabel").textContent = isAnnouncement
    ? "Buong Nilalaman ng Anunsyo"
    : "Buong Nilalaman ng Dokumento";
  document.getElementById("contentInput").placeholder = isAnnouncement
    ? "Isulat dito ang buong detalye ng proyekto, programa, kaganapan, o opisyal na pabatid. Maaari mong gamitin ang formatting buttons sa itaas."
    : "I-paste o isulat dito ang buong dokumento. Piliin ang teksto at gamitin ang formatting buttons sa itaas.";
  document.getElementById("numberFieldLabel").textContent = isAnnouncement
    ? "Uri o Sanggunian (opsyonal)"
    : "Numero o Sanggunian";
  document.getElementById("numberInput").placeholder = isAnnouncement
    ? "Hal. Proyekto, Programa, Kaganapan, o Advisory"
    : isForm
      ? "Hindi kailangan para sa form"
      : "Hal. Executive Order Blg. 07, Serye ng 2026";

  document.getElementById("urlInput").required = isForm;
  document.getElementById("urlRequirementText").textContent = isForm
    ? "(kailangan para sa mga form)"
    : "(opsyonal)";
  document.getElementById("urlHelpText").textContent = isForm
    ? "Ilagay ang opisyal na Google Form link."
    : isAnnouncement
      ? "Opsyonal na link para sa registration form, pahina ng kaganapan, album ng larawan, o karagdagang detalye."
      : hasInternalPage
        ? "Opsyonal na link para sa nilagdaang PDF o Google Drive file."
        : "Opsyonal na link para sa karagdagang detalye.";
}

async function loadRecords() {
  if (activeSection === "Settings") {
    await loadSettings();
    return;
  }

  recordsList.innerHTML = `<div class="loading-card">Kinukuha ang mga record…</div>`;
  try {
    const result = await jsonp({ action: "list", section: activeSection, includeDrafts: "true" });
    records = result.data || [];
    renderRecords();
  } catch (error) {
    recordsList.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderRecords() {
  document.getElementById("recordsTitle").textContent = SECTION_NAMES[activeSection];

  if (!records.length) {
    recordsList.innerHTML = `<div class="empty-state">Wala pang record sa seksyong ito.</div>`;
    return;
  }

  const sorted = [...records].sort((a, b) => {
    const orderDiff = Number(a.order || 0) - Number(b.order || 0);
    return orderDiff !== 0 ? orderDiff : String(b.date || "").localeCompare(String(a.date || ""));
  });

  recordsList.innerHTML = sorted.map((item) => `
    <article class="record-item">
      <div class="record-summary">
        ${item.image ? `<span class="record-image-indicator">May larawan</span>` : ""}
        <h3>
          ${escapeHtml(item.title)}
          <span class="record-status ${String(item.published).toLowerCase() === "true" ? "" : "draft"}">
            ${String(item.published).toLowerCase() === "true" ? "Nakalathala" : "Draft"}
          </span>
        </h3>
        <p>${escapeHtml(item.number || "")}${item.date ? ` · ${escapeHtml(item.date)}` : ""}</p>
      </div>
      <div class="record-actions">
        <button class="button button-secondary button-small" data-edit="${escapeHtml(item.id)}">I-edit</button>
        <button class="button button-danger button-small" data-delete="${escapeHtml(item.id)}">Tanggalin</button>
      </div>
    </article>
  `).join("");

  recordsList.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => editRecord(button.dataset.edit));
  });
  recordsList.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteRecord(button.dataset.delete));
  });
}

function resetForm() {
  entryForm.reset();
  document.getElementById("entryId").value = "";
  document.getElementById("orderInput").value = "0";
  document.getElementById("publishedInput").checked = true;
  document.getElementById("editorTitle").textContent = "Magdagdag ng Bagong Entry";
  document.getElementById("cancelEditButton").classList.add("hidden");
  document.getElementById("saveButton").textContent = "I-save ang Entry";
  configureEntryFields();
}

function editRecord(id) {
  const item = records.find((record) => String(record.id) === String(id));
  if (!item) return;

  document.getElementById("entryId").value = item.id || "";
  document.getElementById("titleInput").value = item.title || "";
  document.getElementById("descriptionInput").value = item.description || "";
  document.getElementById("contentInput").value = item.content || "";
  document.getElementById("numberInput").value = item.number || "";
  document.getElementById("dateInput").value = item.date || "";
  document.getElementById("imageInput").value = item.image || "";
  document.getElementById("urlInput").value = item.url === "#" ? "" : (item.url || "");
  document.getElementById("iconInput").value = item.icon || "";
  document.getElementById("orderInput").value = item.order || 0;
  document.getElementById("publishedInput").checked = String(item.published).toLowerCase() === "true";

  document.getElementById("editorTitle").textContent = "I-edit ang Entry";
  document.getElementById("cancelEditButton").classList.remove("hidden");
  document.getElementById("saveButton").textContent = "I-update ang Entry";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteRecord(id) {
  const item = records.find((record) => String(record.id) === String(id));
  if (!item) return;

  if (!window.confirm(`Talagang tatanggalin ang “${item.title}”? Hindi na ito maibabalik.`)) return;

  try {
    await jsonp({ action: "delete", section: activeSection, id });
    showToast("Natanggal na ang entry.");
    resetForm();
    await loadRecords();
  } catch (error) {
    showToast(error.message);
  }
}

async function uploadLongContent(content) {
  if (!content) return "";
  const chunks = [];
  for (let index = 0; index < content.length; index += CONTENT_CHUNK_SIZE) {
    chunks.push(content.slice(index, index + CONTENT_CHUNK_SIZE));
  }

  const uploadId = `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  for (let index = 0; index < chunks.length; index += 1) {
    await jsonp({
      action: "uploadChunk",
      uploadId,
      index: String(index),
      total: String(chunks.length),
      chunk: chunks[index]
    });
  }
  return uploadId;
}

async function saveRecord(event) {
  event.preventDefault();

  const content = document.getElementById("contentInput").value.trim();
  if (content.length > 45000) {
    showToast("Masyadong mahaba ang nilalaman. Hanggang 45,000 characters lamang.");
    return;
  }

  if (INTERNAL_DOCUMENT_SECTIONS.has(activeSection) && !content && !document.getElementById("urlInput").value.trim()) {
    showToast("Maglagay ng buong nilalaman o external link.");
    return;
  }

  const payload = {
    id: document.getElementById("entryId").value.trim(),
    title: document.getElementById("titleInput").value.trim(),
    description: document.getElementById("descriptionInput").value.trim(),
    number: document.getElementById("numberInput").value.trim(),
    date: document.getElementById("dateInput").value,
    image: document.getElementById("imageInput").value.trim(),
    url: document.getElementById("urlInput").value.trim(),
    icon: document.getElementById("iconInput").value.trim(),
    order: document.getElementById("orderInput").value || "0",
    published: document.getElementById("publishedInput").checked ? "true" : "false"
  };

  const button = document.getElementById("saveButton");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Sine-save…";

  try {
    let uploadId = "";
    if (content) {
      button.textContent = "Ina-upload ang nilalaman…";
      uploadId = await uploadLongContent(content);
    }

    button.textContent = "Sine-save…";
    await jsonp({
      action: "upsert",
      section: activeSection,
      uploadId,
      payload: JSON.stringify(payload)
    }, 35000);

    showToast(payload.id ? "Na-update na ang entry." : "Nagawa na ang bagong entry.");
    resetForm();
    await loadRecords();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function loadSettings() {
  try {
    const result = await jsonp({ action: "getSettings" });
    const settings = result.data || {};
    document.getElementById("siteTitleInput").value = settings.siteTitle || "";
    document.getElementById("siteSubtitleInput").value = settings.siteSubtitle || "";
    document.getElementById("heroTitleInput").value = settings.heroTitle || "";
    document.getElementById("heroDescriptionInput").value = settings.heroDescription || "";
    document.getElementById("logoUrlInput").value = settings.logoUrl || "";
    document.getElementById("mayorImageUrlInput").value = settings.mayorImageUrl || "";
    document.getElementById("heroImageUrlInput").value = settings.heroImageUrl || "";
    document.getElementById("defaultDocumentImageUrlInput").value = settings.defaultDocumentImageUrl || "";
    document.getElementById("mayorNameInput").value = settings.mayorName || "";
    document.getElementById("meetingButtonLabelInput").value = settings.meetingButtonLabel || "Makipagpulong kay Mayor";
    document.getElementById("meetingUrlInput").value = settings.meetingUrl || "";
    document.getElementById("footerTextInput").value = settings.footerText || "";
  } catch (error) {
    showToast(error.message);
  }
}

async function saveSettings(event) {
  event.preventDefault();

  const settings = {
    siteTitle: document.getElementById("siteTitleInput").value.trim(),
    siteSubtitle: document.getElementById("siteSubtitleInput").value.trim(),
    heroTitle: document.getElementById("heroTitleInput").value.trim(),
    heroDescription: document.getElementById("heroDescriptionInput").value.trim(),
    logoUrl: document.getElementById("logoUrlInput").value.trim(),
    mayorImageUrl: document.getElementById("mayorImageUrlInput").value.trim(),
    heroImageUrl: document.getElementById("heroImageUrlInput").value.trim(),
    defaultDocumentImageUrl: document.getElementById("defaultDocumentImageUrlInput").value.trim(),
    mayorName: document.getElementById("mayorNameInput").value.trim(),
    meetingButtonLabel: document.getElementById("meetingButtonLabelInput").value.trim(),
    meetingUrl: document.getElementById("meetingUrlInput").value.trim(),
    footerText: document.getElementById("footerTextInput").value.trim()
  };

  const button = document.getElementById("saveSettingsButton");
  button.disabled = true;
  button.textContent = "Sine-save…";

  try {
    await jsonp({ action: "saveSettings", payload: JSON.stringify(settings) });
    showToast("Na-save na ang mga larawan at setting ng website.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "I-save ang mga Setting";
  }
}

function switchSection(section) {
  activeSection = section;
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.section === section);
  });

  const isSettings = section === "Settings";
  entryEditor.classList.toggle("hidden", isSettings);
  recordsPanel.classList.toggle("hidden", isSettings);
  settingsEditor.classList.toggle("hidden", !isSettings);

  if (isSettings) {
    loadSettings();
    return;
  }

  document.getElementById("editorEyebrow").textContent = SECTION_NAMES[section];
  resetForm();
  loadRecords();
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminToken = document.getElementById("adminToken").value.trim();
  await validateLogin();
});

document.getElementById("logoutButton").addEventListener("click", () => {
  adminToken = "";
  sessionStorage.removeItem("egovAdminToken");
  showLogin();
});

document.getElementById("refreshButton").addEventListener("click", loadRecords);
document.getElementById("cancelEditButton").addEventListener("click", resetForm);
entryForm.addEventListener("submit", saveRecord);
settingsForm.addEventListener("submit", saveSettings);

document.querySelectorAll(".admin-tab").forEach((button) => {
  button.addEventListener("click", () => switchSection(button.dataset.section));
});

document.querySelectorAll("[data-document-format]").forEach((button) => {
  button.addEventListener("click", () => applyDocumentFormatting(button.dataset.documentFormat));
});

document.getElementById("contentInput").addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === "b") {
    event.preventDefault();
    applyDocumentFormatting("bold");
  } else if (key === "i") {
    event.preventDefault();
    applyDocumentFormatting("italic");
  }
});

configureEntryFields();
if (adminToken) validateLogin();
else showLogin();
