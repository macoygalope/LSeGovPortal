import { forgetCurrentCitizenId, getCurrentCitizenId } from "../lib/citizen.ts";
import { fil } from "../lib/messages/fil.ts";
import { LABELS } from "../lib/sections.ts";
import { onLangChange, t } from "../scripts/i18n.ts";

// The dashboard's script. It signs in with a citizen ID, which the admin API
// (src/lib/admin-api.ts, served only by `npm run admin`) checks against the
// site-admin whitelist, and then sends the session it gets back in a header.
// The ID is the one the kiosk puts on the URL (?citizenId=), else typed in.

const API = "/admin-api";
const SESSION_KEY = "egovAdminSession";

function sectionName(section) {
  return section === "Settings" ? t("admin.tab.Settings") : t(LABELS[section].plural);
}

const AUTO_NUMBER_SECTIONS = new Set(["ExecutiveOrders", "Memorandums", "Resolutions"]);
const MAX_PINNED_ANNOUNCEMENTS = 3;

/** Which input holds each field the API can name in an error. Settings are `<name>Input`. */
const FIELD_INPUT = {
  title: "titleInput",
  description: "descriptionInput",
  number: "numberInput",
  date: "dateInput",
  url: "urlInput",
  image: "imageInput",
  icon: "iconInput",
  order: "orderInput",
  content: "contentInput",
  pinOrder: "pinOrderInput",
  pinExpires: "pinExpiresInput",
  subject: "memoSubjectInput",
  memoTo: "memoToInput",
  memoFrom: "memoFromInput",
  signatureImage: "memoSignatureInput",
  signatoryName: "memoSignatoryNameInput",
  signatoryPosition: "memoSignatoryPositionInput",
};

let activeSection = "Forms";
let records = [];
let recordsLoaded = false;
let editingId = "";
let loadSequence = 0;
let adminToken = sessionStorage.getItem(SESSION_KEY) || "";
/** Who is signed in: { citizenId, name }, from the API. */
let currentAdmin = null;

const loginPanel = document.getElementById("loginPanel");
const dashboard = document.getElementById("dashboard");
const entryEditor = document.getElementById("entryEditor");
const recordsPanel = document.getElementById("recordsPanel");
const settingsEditor = document.getElementById("settingsEditor");
const entryForm = document.getElementById("entryForm");
const settingsForm = document.getElementById("settingsForm");
const recordsList = document.getElementById("recordsList");
const pinWarning = document.getElementById("pinWarning");
const citizenIdInput = document.getElementById("citizenIdInput");
const loginStatus = document.getElementById("loginStatus");
const loginButton = document.getElementById("loginButton");

/** An answer from the API that says no: its `code` is what gets translated. */
class ApiError extends Error {
  constructor(message, { code = "", field = "", vars, status = 0 } = {}) {
    super(message);
    this.code = code;
    this.field = field;
    this.vars = vars;
    this.status = status;
  }
}

/** The error in the language shown. Unknown codes keep the API's own (English) text. */
function errorText(error) {
  const key = `admin.be.${error.code}`;
  return error.code && key in fil ? t(key, error.vars) : error.message;
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(t("admin.err.connect"));
  }

  let answer = null;
  try {
    answer = await response.json();
  } catch {
    // Not JSON: handled below.
  }
  if (!answer || answer.ok === false || !response.ok) {
    throw new ApiError(answer?.error || t("admin.err.failed"), {
      code: answer?.code,
      field: answer?.field,
      vars: answer?.vars,
      status: response.status,
    });
  }
  return answer.data;
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

function clearFieldErrors() {
  document.querySelectorAll("[aria-invalid]").forEach((input) => input.removeAttribute("aria-invalid"));
}

/** Shows what went wrong, and marks the input the API pointed at. */
function showError(error, inputId = "") {
  if (error.status === 401) {
    logout();
    showToast(errorText(error));
    return;
  }
  showToast(errorText(error));
  const input = inputId && document.getElementById(inputId);
  if (!input) return;
  input.setAttribute("aria-invalid", "true");
  input.addEventListener("input", () => input.removeAttribute("aria-invalid"), { once: true });
  input.focus();
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
    .map((line, index) => (line.trim() ? transformer(line, index) : line))
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

function renderWho() {
  document.getElementById("adminWho").textContent = currentAdmin
    ? t("admin.who", { name: currentAdmin.name, citizenId: currentAdmin.citizenId })
    : "";
}

function showDashboard(admin) {
  currentAdmin = admin;
  renderWho();
  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

function showLogin() {
  currentAdmin = null;
  renderWho();
  loginPanel.classList.remove("hidden");
  dashboard.classList.add("hidden");
}

/** Forgets the session here (the server drops it on its own when it runs out). */
function logout() {
  adminToken = "";
  sessionStorage.removeItem(SESSION_KEY);
  showLogin();
}

function setLoginStatus(message) {
  loginStatus.textContent = message;
  loginStatus.hidden = !message;
  loginButton.disabled = Boolean(message);
}

async function openDashboard(admin) {
  showDashboard(admin);
  await switchSection(activeSection);
}

/** Asks the server whether this citizen is on the admin list, and opens the dashboard if so. */
async function signIn(citizenId) {
  setLoginStatus(t("admin.login.checking"));
  try {
    const data = await request("POST", "/login", { citizenId });
    adminToken = data.token;
    sessionStorage.setItem(SESSION_KEY, adminToken);
    await openDashboard(data.admin);
  } catch (error) {
    adminToken = "";
    sessionStorage.removeItem(SESSION_KEY);
    showLogin();
    showError(error, "citizenIdInput");
  } finally {
    setLoginStatus("");
  }
}

/** Picks up a sign-in from earlier in this browser tab, if the server still honours it. */
async function resumeSession() {
  try {
    const data = await request("GET", "/auth");
    await openDashboard(data.admin);
    return true;
  } catch {
    // Run out, or the server restarted: fall back to signing in again.
    adminToken = "";
    sessionStorage.removeItem(SESSION_KEY);
    showLogin();
    return false;
  }
}

async function signOut() {
  try {
    await request("POST", "/logout");
  } catch {
    // The session is dropped here either way.
  }
  logout();
  // Without this the kiosk's ?citizenId= would sign the same citizen straight back in.
  forgetCurrentCitizenId();
  citizenIdInput.value = "";
}

function configureEntryFields() {
  const isForm = activeSection === "Forms";
  const isAnnouncement = activeSection === "Announcements";
  const isMemorandum = activeSection === "Memorandums";
  const hasAutoNumber = AUTO_NUMBER_SECTIONS.has(activeSection);

  document.getElementById("contentFieldGroup").classList.remove("hidden");
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
  document.getElementById("dateInput").required = hasAutoNumber;

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
    // A form has no number; an announcement's is free text.
    input.readOnly = activeSection === "Forms";
    input.classList.remove("auto-number-readonly");
    return;
  }

  input.readOnly = autoCheckbox.checked;
  input.classList.toggle("auto-number-readonly", autoCheckbox.checked);
  document.getElementById("autoNumberHelp").textContent = t(
    autoCheckbox.checked
      ? input.value
        ? "admin.auto.help.assigned"
        : "admin.auto.help.next"
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
  recordsLoaded = false;
  const mine = ++loadSequence;
  recordsList.innerHTML = `<div class="loading-card">${escapeHtml(t("admin.records.loading"))}</div>`;
  try {
    const data = await request("GET", `/records/${activeSection}`);
    // A slower answer for a section that is no longer shown is dropped.
    if (mine !== loadSequence) return;
    records = data || [];
    recordsLoaded = true;
    renderRecords();
  } catch (error) {
    if (mine !== loadSequence) return;
    if (error.status === 401) {
      showError(error);
      return;
    }
    recordsList.innerHTML = `<div class="error-state">${escapeHtml(errorText(error))}</div>`;
  }
}

function localToday() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function isActivePinnedAnnouncement(item) {
  if (!item.pinned) return false;
  return !item.pinExpires || item.pinExpires >= localToday();
}

/** Only the first three active pins show on the site; say so when there are more. */
function renderPinWarning() {
  const count = activeSection === "Announcements" ? records.filter(isActivePinnedAnnouncement).length : 0;
  pinWarning.classList.toggle("hidden", count <= MAX_PINNED_ANNOUNCEMENTS);
  pinWarning.textContent = count > MAX_PINNED_ANNOUNCEMENTS ? t("admin.pin.tooMany", { count }) : "";
}

function renderRecords() {
  document.getElementById("recordsTitle").textContent = sectionName(activeSection);
  renderPinWarning();

  if (!records.length) {
    recordsList.innerHTML = `<div class="empty-state">${escapeHtml(t("admin.records.empty"))}</div>`;
    return;
  }

  // The API already sends them in the order the site uses: admin order, then newest.
  recordsList.innerHTML = records
    .map(
      (item) => `
    <article class="record-item">
      <div class="record-summary">
        ${item.image ? `<span class="record-image-indicator">${escapeHtml(t("admin.record.hasImage"))}</span>` : ""}
        ${activeSection === "Announcements" && isActivePinnedAnnouncement(item) ? `<span class="record-pin-indicator">${escapeHtml(t("admin.record.pinned"))}</span>` : ""}
        <h3>
          ${escapeHtml(item.title)}
          <span class="record-status ${item.published ? "" : "draft"}">
            ${escapeHtml(t(item.published ? "admin.record.published" : "admin.record.draft"))}
          </span>
        </h3>
        <p>${escapeHtml(item.number || "")}${item.date ? ` · ${escapeHtml(item.date)}` : ""}</p>
      </div>
      <div class="record-actions">
        <button class="button button-secondary button-small" data-edit="${escapeHtml(item.id)}">${escapeHtml(t("admin.record.edit"))}</button>
        <button class="button button-danger button-small" data-delete="${escapeHtml(item.id)}">${escapeHtml(t("admin.record.delete"))}</button>
      </div>
    </article>
  `
    )
    .join("");

  recordsList.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => editRecord(button.dataset.edit));
  });
  recordsList.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteRecord(button.dataset.delete));
  });
}

/** The editor's title and save button follow whether a record is being edited. */
function renderEditorHeading() {
  document.getElementById("editorTitle").textContent = t(editingId ? "admin.editor.edit" : "admin.editor.new");
  const saveButton = document.getElementById("saveButton");
  // While a save is running the button shows progress instead.
  if (!saveButton.disabled) saveButton.textContent = t(editingId ? "admin.update" : "admin.save");
}

function resetForm() {
  entryForm.reset();
  clearFieldErrors();
  document.getElementById("orderInput").value = "0";
  document.getElementById("publishedInput").checked = true;
  document.getElementById("autoNumberInput").checked = AUTO_NUMBER_SECTIONS.has(activeSection);
  document.getElementById("pinnedInput").checked = false;
  document.getElementById("pinOrderInput").value = "1";
  document.getElementById("pinExpiresInput").value = "";
  editingId = "";
  renderEditorHeading();
  document.getElementById("cancelEditButton").classList.add("hidden");
  configureEntryFields();
}

function editRecord(id) {
  const item = records.find((record) => record.id === id);
  if (!item) return;

  clearFieldErrors();
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
  document.getElementById("autoNumberInput").checked = item.autoNumber === true;
  document.getElementById("pinnedInput").checked = item.pinned === true;
  document.getElementById("pinOrderInput").value = item.pinOrder || 1;
  document.getElementById("pinExpiresInput").value = item.pinExpires || "";
  document.getElementById("imageInput").value = item.image || "";
  document.getElementById("urlInput").value = item.url === "#" ? "" : item.url || "";
  document.getElementById("iconInput").value = item.icon || "";
  document.getElementById("orderInput").value = item.order || 0;
  document.getElementById("publishedInput").checked = item.published === true;

  editingId = item.id;
  renderEditorHeading();
  document.getElementById("cancelEditButton").classList.remove("hidden");
  configureEntryFields();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteRecord(id) {
  const item = records.find((record) => record.id === id);
  if (!item) return;

  if (!window.confirm(t("admin.delete.confirm", { title: item.title }))) return;

  try {
    await request("DELETE", `/records/${activeSection}/${encodeURIComponent(id)}`);
    showToast(t("admin.delete.done"));
    if (editingId === id) resetForm();
    await loadRecords();
  } catch (error) {
    showError(error);
  }
}

async function saveRecord(event) {
  event.preventDefault();
  clearFieldErrors();

  const hasAutoNumber = AUTO_NUMBER_SECTIONS.has(activeSection);
  const isMemorandum = activeSection === "Memorandums";
  const value = (id) => document.getElementById(id).value.trim();
  // The API ignores what a section doesn't use, so every section sends the whole form.
  const payload = {
    title: isMemorandum ? value("memoSubjectInput") : value("titleInput"),
    description: value("descriptionInput"),
    subject: value("memoSubjectInput"),
    memoTo: value("memoToInput"),
    memoFrom: value("memoFromInput"),
    signatureImage: value("memoSignatureInput"),
    signatoryName: value("memoSignatoryNameInput"),
    signatoryPosition: value("memoSignatoryPositionInput"),
    content: value("contentInput"),
    number: value("numberInput"),
    date: document.getElementById("dateInput").value,
    pinned: document.getElementById("pinnedInput").checked,
    pinOrder: Number(document.getElementById("pinOrderInput").value) || 1,
    pinExpires: document.getElementById("pinExpiresInput").value,
    image: value("imageInput"),
    url: value("urlInput"),
    icon: value("iconInput"),
    order: Number(document.getElementById("orderInput").value) || 0,
    published: document.getElementById("publishedInput").checked,
  };
  if (hasAutoNumber) payload.autoNumber = document.getElementById("autoNumberInput").checked;

  const wasEditing = Boolean(editingId);
  const button = document.getElementById("saveButton");
  button.disabled = true;
  button.textContent = t("admin.saving");

  try {
    const saved = wasEditing
      ? await request("PUT", `/records/${activeSection}/${encodeURIComponent(editingId)}`, payload)
      : await request("POST", `/records/${activeSection}`, payload);
    // Say which number a numbered document was given.
    const assigned = hasAutoNumber && saved.number ? ` ${saved.number}` : "";
    showToast(t(wasEditing ? "admin.toast.updated" : "admin.toast.created", { number: assigned }));
    resetForm();
    await loadRecords();
  } catch (error) {
    showError(error, FIELD_INPUT[error.field]);
  } finally {
    button.disabled = false;
    renderEditorHeading();
  }
}

async function loadSettings() {
  try {
    const settings = await request("GET", "/settings");
    for (const [name, text] of Object.entries(settings)) {
      const input = document.getElementById(`${name}Input`);
      if (input) input.value = text || "";
    }
  } catch (error) {
    showError(error);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  clearFieldErrors();

  const settings = {};
  settingsForm.querySelectorAll("input[id$='Input'], textarea[id$='Input']").forEach((input) => {
    settings[input.id.slice(0, -"Input".length)] = input.value.trim();
  });

  const button = document.getElementById("saveSettingsButton");
  button.disabled = true;
  button.textContent = t("admin.saving");

  try {
    await request("PUT", "/settings", settings);
    showToast(t("admin.set.saved"));
  } catch (error) {
    showError(error, error.field ? `${error.field}Input` : "");
  } finally {
    button.disabled = false;
    button.textContent = t("admin.set.save");
  }
}

async function switchSection(section) {
  activeSection = section;
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.section === section);
  });

  const isSettings = section === "Settings";
  entryEditor.classList.toggle("hidden", isSettings);
  recordsPanel.classList.toggle("hidden", isSettings);
  settingsEditor.classList.toggle("hidden", !isSettings);

  if (isSettings) {
    clearFieldErrors();
    await loadSettings();
    return;
  }

  document.getElementById("editorEyebrow").textContent = sectionName(section);
  resetForm();
  await loadRecords();
}

document.getElementById("loginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  signIn(citizenIdInput.value.trim());
});

document.getElementById("logoutButton").addEventListener("click", signOut);

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
  renderWho();
  if (!loginStatus.hidden) loginStatus.textContent = t("admin.login.checking");
  document.getElementById("editorEyebrow").textContent = sectionName(activeSection);
  document.getElementById("recordsTitle").textContent = sectionName(activeSection);
  renderEditorHeading();
  configureEntryFields();
  if (recordsLoaded) renderRecords();
  const settingsButton = document.getElementById("saveSettingsButton");
  if (!settingsButton.disabled) settingsButton.textContent = t("admin.set.save");
});

configureEntryFields();

// Inside the game the kiosk has already said who is using it: check that citizen
// against the list without asking. Anywhere else the ID is typed in (or given as
// /admin?citizenId=...).
const kioskCitizenId = getCurrentCitizenId();
citizenIdInput.value = kioskCitizenId;
showLogin();
(async () => {
  if (adminToken && (await resumeSession())) return;
  if (kioskCitizenId) await signIn(kioskCitizenId);
})();
