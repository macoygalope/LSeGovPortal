import { translate, translateBackendError } from "../lib/i18n.ts";
import { LABELS } from "../lib/sections.ts";
import { getLang, onLangChange, t } from "../scripts/i18n.ts";

const API_URL = import.meta.env.PUBLIC_EGOV_API_URL || "";

function sectionName(section) {
  return section === "Settings" ? t("admin.tab.Settings") : t(LABELS[section].plural);
}

const INTERNAL_DOCUMENT_SECTIONS = new Set(["Forms", "Announcements", "ExecutiveOrders", "Memorandums", "Resolutions"]);
const AUTO_NUMBER_SECTIONS = new Set(["ExecutiveOrders", "Memorandums", "Resolutions"]);
const CONTENT_CHUNK_SIZE = 1050;
const CONTENT_UPLOAD_MAX_RETRIES = 3;
const CONTENT_UPLOAD_RETRY_DELAY_MS = 900;

let activeSection = "Forms";
let records = [];
let recordsLoaded = false;
let editingRecord = false;
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
  return API_URL && !API_URL.includes("REPLACE_ME");
}

function jsonp(params, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      reject(new Error(t("admin.err.noApiUrl")));
      return;
    }

    const callbackName = `egovAdminCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t("admin.err.timeout")));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (!payload || payload.ok === false) reject(new Error(payload?.error ? translateBackendError(payload.error, getLang()) : t("admin.err.failed")));
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
      reject(new Error(t("admin.err.connect")));
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
    const placeholder = t(command === "bold" ? "admin.fmt.placeholder.bold" : "admin.fmt.placeholder.italic");
    const content = selected || placeholder;
    const replacement = `${marker}${content}${marker}`;
    replaceDocumentSelection(replacement, marker.length, marker.length + content.length);
    return;
  }

  if (command === "heading") {
    transformSelectedLines((line) => `## ${line.replace(/^#{1,3}\s+/, "")}`, t("admin.fmt.placeholder.heading"));
    return;
  }

  if (command === "bullet") {
    transformSelectedLines((line) => `- ${line.replace(/^\s*[-+]\s+/, "")}`, t("admin.fmt.placeholder.list"));
    return;
  }

  if (command === "numbered") {
    transformSelectedLines(
      (line, index) => `${index + 1}. ${line.replace(/^\s*\d+[.)]\s+/, "")}`,
      t("admin.fmt.placeholder.list")
    );
    return;
  }

  if (command === "quote") {
    transformSelectedLines((line) => `> ${line.replace(/^\s*>\s?/, "")}`, t("admin.fmt.placeholder.quote"));
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
  const isMemorandum = activeSection === "Memorandums";
  const hasAutoNumber = AUTO_NUMBER_SECTIONS.has(activeSection);

  document.getElementById("contentFieldGroup").classList.toggle("hidden", !hasInternalPage);
  document.getElementById("memorandumFieldsGroup").classList.toggle("hidden", !isMemorandum);
  document.getElementById("titleFieldGroup").classList.toggle("hidden", isMemorandum);
  document.getElementById("autoNumberFields").classList.toggle("hidden", !hasAutoNumber);
  document.getElementById("announcementPinFields").classList.toggle("hidden", !isAnnouncement);
  document.getElementById("numberInput").closest("label").classList.toggle("field-muted", isForm);

  document.getElementById("titleInput").required = !isMemorandum;
  document.getElementById("memoSubjectInput").required = isMemorandum;
  document.getElementById("memoToInput").required = isMemorandum;
  document.getElementById("memoFromInput").required = isMemorandum;
  document.getElementById("numberInput").required = false;
  document.getElementById("dateInput").required = isMemorandum || hasAutoNumber;

  const contentKind = isForm ? "form" : isAnnouncement ? "announcement" : isMemorandum ? "memo" : "doc";
  document.getElementById("contentFieldLabel").textContent = t(`admin.content.label.${contentKind}`);
  document.getElementById("contentInput").placeholder = t(`admin.content.ph.${contentKind}`);
  document.getElementById("numberFieldLabel").textContent = t(
    isAnnouncement
      ? "admin.number.label.announcement"
      : isMemorandum
        ? "admin.number.label.memo"
        : "admin.number.label.default"
  );
  document.getElementById("numberInput").placeholder = isAnnouncement
    ? t("admin.number.ph.announcement")
    : isForm
      ? t("admin.number.ph.form")
      : t("admin.number.ph.auto");

  document.getElementById("urlInput").required = isForm;
  document.getElementById("urlRequirementText").textContent = t(isForm ? "admin.url.required" : "admin.url.optional");
  document.getElementById("urlHelpText").textContent = t(
    isForm ? "admin.url.help.form" : isAnnouncement ? "admin.url.help.announcement" : "admin.url.help.doc"
  );

  syncNumberingInputState();
  syncPinFieldsState();
}

function syncNumberingInputState() {
  const input = document.getElementById("numberInput");
  const autoCheckbox = document.getElementById("autoNumberInput");
  const hasAutoNumber = AUTO_NUMBER_SECTIONS.has(activeSection);

  if (!hasAutoNumber) {
    input.readOnly = activeSection === "Forms";
    return;
  }

  input.readOnly = autoCheckbox.checked;
  input.classList.toggle("auto-number-readonly", autoCheckbox.checked);
  document.getElementById("autoNumberHelp").textContent = t(
    autoCheckbox.checked
      ? (input.value ? "admin.auto.help.assigned" : "admin.auto.help.next")
      : "admin.auto.help.manual"
  );
}

function syncPinFieldsState() {
  const enabled = activeSection === "Announcements" && document.getElementById("pinnedInput").checked;
  document.querySelectorAll(".pin-detail-fields input").forEach((input) => {
    input.disabled = !enabled;
  });
}

async function loadRecords() {
  if (activeSection === "Settings") {
    await loadSettings();
    return;
  }

  recordsLoaded = false;
  recordsList.innerHTML = `<div class="loading-card">${escapeHtml(t("admin.records.loading"))}</div>`;
  try {
    const result = await jsonp({ action: "list", section: activeSection, includeDrafts: "true" });
    records = result.data || [];
    recordsLoaded = true;
    renderRecords();
  } catch (error) {
    recordsList.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

function isActivePinnedAnnouncement(item) {
  if (!(item.pinned === true || String(item.pinned).toLowerCase() === "true")) return false;
  if (!item.pinExpires) return true;
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return String(item.pinExpires) >= localToday;
}

function renderRecords() {
  document.getElementById("recordsTitle").textContent = sectionName(activeSection);

  if (!records.length) {
    recordsList.innerHTML = `<div class="empty-state">${escapeHtml(t("admin.records.empty"))}</div>`;
    return;
  }

  const sorted = [...records].sort((a, b) => {
    const orderDiff = Number(a.order || 0) - Number(b.order || 0);
    return orderDiff !== 0 ? orderDiff : String(b.date || "").localeCompare(String(a.date || ""));
  });

  recordsList.innerHTML = sorted.map((item) => `
    <article class="record-item">
      <div class="record-summary">
        ${item.image ? `<span class="record-image-indicator">${escapeHtml(t("admin.record.hasImage"))}</span>` : ""}
        ${activeSection === "Announcements" && isActivePinnedAnnouncement(item) ? `<span class="record-pin-indicator">${escapeHtml(t("admin.record.pinned"))}</span>` : ""}
        <h3>
          ${escapeHtml(item.title)}
          <span class="record-status ${String(item.published).toLowerCase() === "true" ? "" : "draft"}">
            ${escapeHtml(t(String(item.published).toLowerCase() === "true" ? "admin.record.published" : "admin.record.draft"))}
          </span>
        </h3>
        <p>${escapeHtml(item.number || "")}${item.date ? ` · ${escapeHtml(item.date)}` : ""}</p>
      </div>
      <div class="record-actions">
        <button class="button button-secondary button-small" data-edit="${escapeHtml(item.id)}">${escapeHtml(t("admin.record.edit"))}</button>
        <button class="button button-danger button-small" data-delete="${escapeHtml(item.id)}">${escapeHtml(t("admin.record.delete"))}</button>
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

/** The editor's title and save button follow whether a record is being edited. */
function renderEditorHeading() {
  document.getElementById("editorTitle").textContent = t(editingRecord ? "admin.editor.edit" : "admin.editor.new");
  const saveButton = document.getElementById("saveButton");
  // While a save is running the button shows progress instead.
  if (!saveButton.disabled) saveButton.textContent = t(editingRecord ? "admin.update" : "admin.save");
}

function resetForm() {
  entryForm.reset();
  document.getElementById("entryId").value = "";
  document.getElementById("orderInput").value = "0";
  document.getElementById("publishedInput").checked = true;
  document.getElementById("autoNumberInput").checked = AUTO_NUMBER_SECTIONS.has(activeSection);
  document.getElementById("pinnedInput").checked = false;
  document.getElementById("pinOrderInput").value = "1";
  document.getElementById("pinExpiresInput").value = "";
  editingRecord = false;
  renderEditorHeading();
  document.getElementById("cancelEditButton").classList.add("hidden");
  configureEntryFields();
}

function editRecord(id) {
  const item = records.find((record) => String(record.id) === String(id));
  if (!item) return;

  document.getElementById("entryId").value = item.id || "";
  document.getElementById("titleInput").value = item.title || "";
  document.getElementById("memoSubjectInput").value = item.subject || item.title || "";
  document.getElementById("memoToInput").value = item.memoTo || "";
  document.getElementById("memoFromInput").value = item.memoFrom || "";
  document.getElementById("memoSignatureInput").value = item.signatureImage || "";
  document.getElementById("memoSignatoryNameInput").value = item.signatoryName || "";
  document.getElementById("memoSignatoryPositionInput").value = item.signatoryPosition || "";
  document.getElementById("descriptionInput").value = item.description || "";
  document.getElementById("contentInput").value = item.content || "";
  document.getElementById("numberInput").value = item.number || "";
  document.getElementById("dateInput").value = item.date || "";
  document.getElementById("autoNumberInput").checked = String(item.autoNumber).toLowerCase() === "true";
  document.getElementById("pinnedInput").checked = String(item.pinned).toLowerCase() === "true";
  document.getElementById("pinOrderInput").value = item.pinOrder || 1;
  document.getElementById("pinExpiresInput").value = item.pinExpires || "";
  document.getElementById("imageInput").value = item.image || "";
  document.getElementById("urlInput").value = item.url === "#" ? "" : (item.url || "");
  document.getElementById("iconInput").value = item.icon || "";
  document.getElementById("orderInput").value = item.order || 0;
  document.getElementById("publishedInput").checked = String(item.published).toLowerCase() === "true";

  editingRecord = true;
  renderEditorHeading();
  document.getElementById("cancelEditButton").classList.remove("hidden");
  configureEntryFields();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteRecord(id) {
  const item = records.find((record) => String(record.id) === String(id));
  if (!item) return;

  if (!window.confirm(t("admin.delete.confirm", { title: item.title }))) return;

  try {
    await jsonp({ action: "delete", section: activeSection, id });
    showToast(t("admin.delete.done"));
    resetForm();
    await loadRecords();
  } catch (error) {
    showToast(error.message);
  }
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStableEntryId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `record_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function ensureStableEntryId() {
  const field = document.getElementById("entryId");
  if (!field.value.trim()) field.value = createStableEntryId();
  return field.value.trim();
}

async function uploadChunkWithRetry({ uploadId, index, total, chunk, onProgress }) {
  let lastError;

  for (let attempt = 1; attempt <= CONTENT_UPLOAD_MAX_RETRIES; attempt += 1) {
    try {
      if (typeof onProgress === "function") {
        onProgress(index + 1, total, attempt);
      }

      return await jsonp({
        action: "uploadChunk",
        uploadId,
        index: String(index),
        total: String(total),
        chunk
      }, 30000);
    } catch (error) {
      lastError = error;
      if (attempt >= CONTENT_UPLOAD_MAX_RETRIES) break;
      await waitMs(CONTENT_UPLOAD_RETRY_DELAY_MS * attempt);
    }
  }

  throw new Error(
    t("admin.err.chunk", { index: index + 1, total, reason: lastError?.message || t("admin.err.retry") })
  );
}

async function uploadLongContent(content, onProgress) {
  if (!content) return "";

  const chunks = [];
  for (let index = 0; index < content.length; index += CONTENT_CHUNK_SIZE) {
    chunks.push(content.slice(index, index + CONTENT_CHUNK_SIZE));
  }

  const uploadId = `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  for (let index = 0; index < chunks.length; index += 1) {
    await uploadChunkWithRetry({
      uploadId,
      index,
      total: chunks.length,
      chunk: chunks[index],
      onProgress
    });
  }

  // Huling verification bago ipasa ang uploadId sa actual save.
  const status = await jsonp({
    action: "uploadStatus",
    uploadId,
    total: String(chunks.length)
  }, 30000);

  const missing = Array.isArray(status.data?.missing) ? status.data.missing : [];
  if (missing.length) {
    for (const missingIndex of missing) {
      const index = Number(missingIndex);
      if (!Number.isInteger(index) || index < 0 || index >= chunks.length) continue;

      await uploadChunkWithRetry({
        uploadId,
        index,
        total: chunks.length,
        chunk: chunks[index],
        onProgress
      });
    }

    const verified = await jsonp({
      action: "uploadStatus",
      uploadId,
      total: String(chunks.length)
    }, 30000);

    if (!verified.data?.complete) {
      throw new Error(t("admin.be.uploadIncomplete"));
    }
  } else if (!status.data?.complete) {
    throw new Error(t("admin.be.uploadIncomplete"));
  }

  return uploadId;
}

async function saveRecord(event) {
  event.preventDefault();

  const content = document.getElementById("contentInput").value.trim();
  if (content.length > 45000) {
    showToast(t("admin.toast.tooLong"));
    return;
  }

  if (INTERNAL_DOCUMENT_SECTIONS.has(activeSection) && !content && !document.getElementById("urlInput").value.trim()) {
    showToast(t("admin.be.needContent"));
    return;
  }

  const isMemorandum = activeSection === "Memorandums";
  const hasAutoNumber = AUTO_NUMBER_SECTIONS.has(activeSection);
  const autoNumber = hasAutoNumber && document.getElementById("autoNumberInput").checked;
  const requestedPublished = document.getElementById("publishedInput").checked;
  const manualNumber = document.getElementById("numberInput").value.trim();
  const memorandumSubject = document.getElementById("memoSubjectInput").value.trim();

  if (hasAutoNumber && requestedPublished && !autoNumber && !manualNumber) {
    showToast(t("admin.toast.needNumber"));
    return;
  }

  const payload = {
    id: ensureStableEntryId(),
    title: isMemorandum ? memorandumSubject : document.getElementById("titleInput").value.trim(),
    description: document.getElementById("descriptionInput").value.trim(),
    subject: memorandumSubject,
    memoTo: document.getElementById("memoToInput").value.trim(),
    memoFrom: document.getElementById("memoFromInput").value.trim(),
    signatureImage: document.getElementById("memoSignatureInput").value.trim(),
    signatoryName: document.getElementById("memoSignatoryNameInput").value.trim(),
    signatoryPosition: document.getElementById("memoSignatoryPositionInput").value.trim(),
    number: manualNumber,
    date: document.getElementById("dateInput").value,
    autoNumber: autoNumber ? "true" : "false",
    pinned: document.getElementById("pinnedInput").checked ? "true" : "false",
    pinOrder: document.getElementById("pinOrderInput").value || "1",
    pinExpires: document.getElementById("pinExpiresInput").value,
    image: document.getElementById("imageInput").value.trim(),
    url: document.getElementById("urlInput").value.trim(),
    icon: document.getElementById("iconInput").value.trim(),
    order: document.getElementById("orderInput").value || "0",
    published: document.getElementById("publishedInput").checked ? "true" : "false"
  };

  const button = document.getElementById("saveButton");
  button.disabled = true;
  button.textContent = t("admin.saving");

  try {
    let uploadId = "";
    if (content) {
      button.textContent = t("admin.preparing");
      uploadId = await uploadLongContent(content, (current, total, attempt) => {
        button.textContent = t(attempt > 1 ? "admin.reuploadPart" : "admin.uploadPart", { current, total });
      });
    }

    button.textContent = t("admin.finishing");
    const result = await jsonp({
      action: "upsert",
      section: activeSection,
      uploadId,
      payload: JSON.stringify(payload)
    }, 60000);

    const assignedNumber = result.data && result.data.number ? ` ${result.data.number}` : "";
    showToast(t(payload.id ? "admin.toast.updated" : "admin.toast.created", { number: assignedNumber }));
    resetForm();
    await loadRecords();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    renderEditorHeading();
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
    document.getElementById("defaultSignatureImageUrlInput").value = settings.defaultSignatureImageUrl || "";
    document.getElementById("defaultSignatoryNameInput").value = settings.defaultSignatoryName || settings.mayorName || "";
    document.getElementById("defaultSignatoryPositionInput").value = settings.defaultSignatoryPosition || "";
    document.getElementById("mayorNameInput").value = settings.mayorName || "";
    document.getElementById("meetingButtonLabelInput").value = settings.meetingButtonLabel || translate("fil", "settings.meetingButtonLabel");
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
    defaultSignatureImageUrl: document.getElementById("defaultSignatureImageUrlInput").value.trim(),
    defaultSignatoryName: document.getElementById("defaultSignatoryNameInput").value.trim(),
    defaultSignatoryPosition: document.getElementById("defaultSignatoryPositionInput").value.trim(),
    mayorName: document.getElementById("mayorNameInput").value.trim(),
    meetingButtonLabel: document.getElementById("meetingButtonLabelInput").value.trim(),
    meetingUrl: document.getElementById("meetingUrlInput").value.trim(),
    footerText: document.getElementById("footerTextInput").value.trim()
  };

  const button = document.getElementById("saveSettingsButton");
  button.disabled = true;
  button.textContent = t("admin.saving");

  try {
    await jsonp({ action: "saveSettings", payload: JSON.stringify(settings) });
    showToast(t("admin.set.saved"));
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = t("admin.set.save");
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

  document.getElementById("editorEyebrow").textContent = sectionName(section);
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

document.getElementById("autoNumberInput").addEventListener("change", syncNumberingInputState);
document.getElementById("pinnedInput").addEventListener("change", syncPinFieldsState);

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

// Re-render the text that this script (rather than the markup) owns.
onLangChange(() => {
  document.getElementById("editorEyebrow").textContent = sectionName(activeSection);
  document.getElementById("recordsTitle").textContent = sectionName(activeSection);
  renderEditorHeading();
  configureEntryFields();
  if (recordsLoaded) renderRecords();
  const settingsButton = document.getElementById("saveSettingsButton");
  if (!settingsButton.disabled) settingsButton.textContent = t("admin.set.save");
});

configureEntryFields();
if (adminToken) validateLogin();
else showLogin();
