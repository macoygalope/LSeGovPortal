/**
 * LOS SANTOS eGOV — GOOGLE SHEETS CMS
 *
 * PAUNANG SETUP
 * 1. Gumawa ng blank Google Sheet.
 * 2. Buksan ang Extensions > Apps Script.
 * 3. I-paste ang buong Code.gs na ito.
 * 4. Patakbuhin ang setupSheets() at aprubahan ang permissions.
 * 5. Patakbuhin ang setAdminToken("MAHABANG_LIHIM_NA_TOKEN").
 * 6. Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone
 * 7. Kopyahin ang /exec URL at ilagay sa config.js.
 */

const CONTENT_SECTIONS = [
  "Forms",
  "Announcements",
  "ExecutiveOrders",
  "Memorandums",
  "Resolutions"
];

const CONTENT_HEADERS = [
  "id",
  "title",
  "description",
  "number",
  "date",
  "url",
  "image",
  "icon",
  "order",
  "published",
  "createdAt",
  "updatedAt",
  "content"
];

const SETTINGS_HEADERS = ["key", "value", "label", "updatedAt"];

const DEFAULT_SETTINGS = {
  siteTitle: {
    value: "Los Santos eGov",
    label: "Pangalan ng Portal"
  },
  siteSubtitle: {
    value: "Opisyal na Portal ng Serbisyong Digital",
    label: "Subtitle ng Portal"
  },
  heroTitle: {
    value: "Mga serbisyo, dokumento, at pabatid ng lungsod—nasa iisang lugar.",
    label: "Pangunahing Pamagat"
  },
  heroDescription: {
    value: "Buksan ang mga opisyal na form, basahin ang mahahalagang anunsyo, at tingnan ang mga dokumentong inilabas ng Pamahalaang Panglungsod.",
    label: "Paliwanag sa Unang Pahina"
  },
  heroImageUrl: {
    value: "",
    label: "Background ng Hero Section"
  },
  logoUrl: {
    value: "",
    label: "Logo o Selyo"
  },
  mayorImageUrl: {
    value: "",
    label: "Larawan ng Punong Lungsod"
  },
  mayorName: {
    value: "Hon. Alejandro Tagalog",
    label: "Pangalan ng Punong Lungsod"
  },
  defaultDocumentImageUrl: {
    value: "",
    label: "Default na Larawan ng Dokumento"
  },
  footerText: {
    value: "© Pamahalaang Panglungsod ng Los Santos. Lahat ng karapatan ay nakalaan.",
    label: "Teksto sa Footer"
  }
};

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  CONTENT_SECTIONS.forEach(function(section) {
    let sheet = ss.getSheetByName(section);
    if (!sheet) sheet = ss.insertSheet(section);
    ensureContentHeaders_(sheet);
  });

  setupSettingsSheet_();
  seedStarterData_();
  SpreadsheetApp.flush();
}

function setAdminToken(token) {
  const cleanToken = String(token || "").trim();
  if (cleanToken.length < 16) {
    throw new Error("Gumamit ng admin token na hindi bababa sa 16 characters.");
  }
  PropertiesService.getScriptProperties().setProperty("ADMIN_TOKEN", cleanToken);
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const callback = params.callback || "";

  try {
    const action = params.action || "all";
    let response;

    if (action === "all") {
      response = {
        ok: true,
        data: getAllPublished_()
      };

    } else if (action === "list") {
      validateSection_(params.section);
      const includeDrafts = String(params.includeDrafts).toLowerCase() === "true";
      if (includeDrafts) requireAdmin_(params.token);

      response = {
        ok: true,
        data: getSection_(params.section, includeDrafts)
      };

    } else if (action === "auth") {
      requireAdmin_(params.token);
      response = {
        ok: true,
        data: { authenticated: true }
      };

    } else if (action === "uploadChunk") {
      requireAdmin_(params.token);
      response = {
        ok: true,
        data: storeUploadChunk_(params)
      };

    } else if (action === "upsert") {
      requireAdmin_(params.token);
      validateSection_(params.section);

      const payload = JSON.parse(params.payload || "{}");
      if (params.uploadId) {
        payload.content = readUploadedContent_(params.uploadId);
      }

      response = {
        ok: true,
        data: upsertRecord_(params.section, payload)
      };

    } else if (action === "delete") {
      requireAdmin_(params.token);
      validateSection_(params.section);

      response = {
        ok: true,
        data: deleteRecord_(params.section, params.id)
      };

    } else if (action === "getSettings") {
      response = {
        ok: true,
        data: getSettings_()
      };

    } else if (action === "saveSettings") {
      requireAdmin_(params.token);
      const payload = JSON.parse(params.payload || "{}");

      response = {
        ok: true,
        data: saveSettings_(payload)
      };

    } else {
      throw new Error("Hindi kilalang action.");
    }

    return output_(response, callback);

  } catch (error) {
    return output_({
      ok: false,
      error: error.message
    }, callback);
  }
}

function getAllPublished_() {
  const result = {
    SiteSettings: getSettings_()
  };

  CONTENT_SECTIONS.forEach(function(section) {
    result[section] = getSection_(section, false);
  });

  return result;
}

function getSection_(section, includeDrafts) {
  const sheet = getContentSheet_(section);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  const rows = values.slice(1).map(function(row) {
    const item = {};

    headers.forEach(function(header, index) {
      item[header] = row[index];
    });

    item.order = Number(item.order || 0);
    item.published = String(item.published).toLowerCase() === "true";
    return item;
  });

  return rows
    .filter(function(item) {
      return item.id && (includeDrafts || item.published);
    })
    .sort(function(a, b) {
      const orderDifference = Number(a.order || 0) - Number(b.order || 0);
      if (orderDifference !== 0) return orderDifference;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
}

function upsertRecord_(section, payload) {
  const title = clean_(payload.title);
  const content = clean_(payload.content);
  const url = clean_(payload.url);

  if (!title) throw new Error("Kailangan ang pamagat.");
  if (content.length > 45000) {
    throw new Error("Hanggang 45,000 characters lamang ang buong nilalaman ng dokumento.");
  }
  if (section === "Forms" && !url) {
    throw new Error("Kailangan ang Google Form link.");
  }
  if (["ExecutiveOrders", "Memorandums", "Resolutions"].indexOf(section) >= 0 && !content && !url) {
    throw new Error("Maglagay ng buong nilalaman o external document link.");
  }

  const sheet = getContentSheet_(section);
  const headers = getContentHeaders_(sheet);
  const now = new Date().toISOString();
  const id = clean_(payload.id) || Utilities.getUuid();
  const lastRow = sheet.getLastRow();
  const idColumn = headers.indexOf("id") + 1;

  let targetRow = -1;

  if (lastRow > 1) {
    const ids = sheet.getRange(2, idColumn, lastRow - 1, 1).getDisplayValues().flat();
    const foundIndex = ids.indexOf(id);
    if (foundIndex >= 0) targetRow = foundIndex + 2;
  }

  let createdAt = now;
  const createdAtColumn = headers.indexOf("createdAt") + 1;

  if (targetRow > 0 && createdAtColumn > 0) {
    createdAt = sheet.getRange(targetRow, createdAtColumn).getDisplayValue() || now;
  }

  const normalized = {
    id: id,
    title: title,
    description: clean_(payload.description),
    number: clean_(payload.number),
    date: clean_(payload.date),
    url: url,
    image: clean_(payload.image),
    icon: clean_(payload.icon),
    order: Number(payload.order || 0),
    published: String(payload.published).toLowerCase() === "true",
    createdAt: createdAt,
    updatedAt: now,
    content: content
  };

  const row = headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(normalized, header)
      ? normalized[header]
      : "";
  });

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    targetRow = sheet.getLastRow();
  }

  const contentColumn = headers.indexOf("content") + 1;
  if (contentColumn > 0) {
    sheet.getRange(targetRow, contentColumn).setWrap(true);
  }

  SpreadsheetApp.flush();
  return { id: id, row: targetRow };
}

function deleteRecord_(section, idValue) {
  const id = clean_(idValue);
  if (!id) throw new Error("Kailangan ang record ID.");

  const sheet = getContentSheet_(section);
  const headers = getContentHeaders_(sheet);
  const idColumn = headers.indexOf("id") + 1;
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) throw new Error("Hindi makita ang record.");

  const ids = sheet.getRange(2, idColumn, lastRow - 1, 1).getDisplayValues().flat();
  const foundIndex = ids.indexOf(id);

  if (foundIndex < 0) throw new Error("Hindi makita ang record.");

  sheet.deleteRow(foundIndex + 2);
  SpreadsheetApp.flush();

  return {
    deleted: true,
    id: id
  };
}

function setupSettingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Settings");

  if (!sheet) sheet = ss.insertSheet("Settings");

  ensureSettingsHeaders_(sheet);

  const values = sheet.getDataRange().getDisplayValues();
  const existingKeys = {};

  if (values.length > 1) {
    const headers = values[0];
    const keyIndex = headers.indexOf("key");

    values.slice(1).forEach(function(row) {
      if (row[keyIndex]) existingKeys[row[keyIndex]] = true;
    });
  }

  const now = new Date().toISOString();

  Object.keys(DEFAULT_SETTINGS).forEach(function(key) {
    if (existingKeys[key]) return;

    sheet.appendRow([
      key,
      DEFAULT_SETTINGS[key].value,
      DEFAULT_SETTINGS[key].label,
      now
    ]);
  });

  sheet.autoResizeColumn(1);
  sheet.setColumnWidth(2, 520);
  sheet.setColumnWidth(3, 250);
  SpreadsheetApp.flush();
}

function getSettings_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Settings");

  if (!sheet) {
    sheet = ss.insertSheet("Settings");
    ensureSettingsHeaders_(sheet);
  } else {
    ensureSettingsHeaders_(sheet);
  }

  const values = sheet.getDataRange().getDisplayValues();
  const result = {};

  if (values.length > 1) {
    const headers = values[0];
    const keyIndex = headers.indexOf("key");
    const valueIndex = headers.indexOf("value");

    values.slice(1).forEach(function(row) {
      const key = row[keyIndex];
      if (key) result[key] = row[valueIndex] || "";
    });
  }

  Object.keys(DEFAULT_SETTINGS).forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = DEFAULT_SETTINGS[key].value;
    }
  });

  return result;
}

function saveSettings_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Settings");

  if (!sheet) sheet = ss.insertSheet("Settings");
  ensureSettingsHeaders_(sheet);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const keyColumn = headers.indexOf("key") + 1;
  const now = new Date().toISOString();
  const lastRow = sheet.getLastRow();

  let keyRows = {};
  if (lastRow > 1) {
    const keys = sheet.getRange(2, keyColumn, lastRow - 1, 1).getDisplayValues().flat();
    keys.forEach(function(key, index) {
      if (key) keyRows[key] = index + 2;
    });
  }

  Object.keys(DEFAULT_SETTINGS).forEach(function(key) {
    const value = Object.prototype.hasOwnProperty.call(payload, key)
      ? clean_(payload[key])
      : DEFAULT_SETTINGS[key].value;

    const row = [
      key,
      value,
      DEFAULT_SETTINGS[key].label,
      now
    ];

    if (keyRows[key]) {
      sheet.getRange(keyRows[key], 1, 1, SETTINGS_HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });

  SpreadsheetApp.flush();
  return getSettings_();
}

function storeUploadChunk_(params) {
  const uploadId = clean_(params.uploadId).replace(/[^a-zA-Z0-9_-]/g, "");
  const index = Number(params.index);
  const total = Number(params.total);
  const chunk = String(params.chunk || "");

  if (!uploadId) throw new Error("Hindi wasto ang upload ID.");
  if (!Number.isInteger(index) || index < 0) throw new Error("Hindi wasto ang chunk index.");
  if (!Number.isInteger(total) || total < 1 || total > 100) throw new Error("Hindi wasto ang dami ng chunks.");

  const cache = CacheService.getScriptCache();
  cache.put("egov-upload-total-" + uploadId, String(total), 900);
  cache.put("egov-upload-" + uploadId + "-" + index, chunk, 900);

  return {
    uploadId: uploadId,
    index: index,
    received: true
  };
}

function readUploadedContent_(uploadIdValue) {
  const uploadId = clean_(uploadIdValue).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!uploadId) throw new Error("Hindi wasto ang content upload ID.");

  const cache = CacheService.getScriptCache();
  const total = Number(cache.get("egov-upload-total-" + uploadId));

  if (!Number.isInteger(total) || total < 1) {
    throw new Error("Nag-expire ang upload ng dokumento. Subukang i-save muli.");
  }

  const chunks = [];

  for (let index = 0; index < total; index += 1) {
    const key = "egov-upload-" + uploadId + "-" + index;
    const chunk = cache.get(key);

    if (chunk === null) {
      throw new Error("May nawawalang bahagi ng dokumento. Subukang i-save muli.");
    }

    chunks.push(chunk);
    cache.remove(key);
  }

  cache.remove("egov-upload-total-" + uploadId);
  return chunks.join("");
}

function requireAdmin_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty("ADMIN_TOKEN");

  if (!expected) {
    throw new Error("Hindi pa naitatakda ang admin token.");
  }

  if (!token || String(token) !== String(expected)) {
    throw new Error("Mali ang admin token.");
  }
}

function validateSection_(section) {
  if (CONTENT_SECTIONS.indexOf(section) === -1) {
    throw new Error("Hindi wastong section.");
  }
}

function getContentSheet_(section) {
  validateSection_(section);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(section);

  if (!sheet) {
    sheet = ss.insertSheet(section);
  }

  ensureContentHeaders_(sheet);
  return sheet;
}

function ensureContentHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(CONTENT_HEADERS);
  } else {
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const existing = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];

    CONTENT_HEADERS.forEach(function(header) {
      if (existing.indexOf(header) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
        existing.push(header);
      }
    });
  }

  sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .setFontWeight("bold")
    .setBackground("#0b1f3a")
    .setFontColor("#ffffff");

  sheet.setFrozenRows(1);
}

function ensureSettingsHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SETTINGS_HEADERS);
  } else {
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const existing = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];

    SETTINGS_HEADERS.forEach(function(header) {
      if (existing.indexOf(header) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
        existing.push(header);
      }
    });
  }

  sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .setFontWeight("bold")
    .setBackground("#0b1f3a")
    .setFontColor("#ffffff");

  sheet.setFrozenRows(1);
}

function getContentHeaders_(sheet) {
  ensureContentHeaders_(sheet);
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
}

function output_(payload, callback) {
  const json = JSON.stringify(payload);

  if (callback) {
    const safeCallback = String(callback).replace(/[^\w.$]/g, "");

    return ContentService
      .createTextOutput(safeCallback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function clean_(value) {
  return value == null ? "" : String(value).trim();
}

function seedStarterData_() {
  const starterData = {
    Forms: [
      {
        title: "OOC Talk Forms",
        description: "Magsumite ng opisyal na OOC concern o kahilingan.",
        url: "PASTE_GOOGLE_FORM_LINK",
        icon: "💬",
        order: 1,
        published: true
      },
      {
        title: "Vehicle Registration Form",
        description: "Iparehistro ang sasakyan sa Pamahalaang Panglungsod.",
        url: "PASTE_GOOGLE_FORM_LINK",
        icon: "🚘",
        order: 2,
        published: true
      },
      {
        title: "Business Registration / Update Form",
        description: "Magparehistro ng negosyo o mag-update ng kasalukuyang business record.",
        url: "PASTE_GOOGLE_FORM_LINK",
        icon: "🏪",
        order: 3,
        published: true
      },
      {
        title: "Organization Application",
        description: "Magsumite ng aplikasyon para sa opisyal na pagkilala sa isang organisasyon.",
        url: "PASTE_GOOGLE_FORM_LINK",
        icon: "👥",
        order: 4,
        published: true
      }
    ],

    Announcements: [
      {
        title: "Maligayang Pagdating sa Los Santos eGov",
        description: "Maaari nang ma-access sa portal na ito ang mga pampublikong form at opisyal na dokumento ng lungsod.",
        date: new Date().toISOString().slice(0, 10),
        icon: "📢",
        order: 1,
        published: true
      }
    ],

    ExecutiveOrders: [
      {
        title: "Halimbawang Executive Order",
        description: "Isang halimbawa ng dokumentong mababasa nang buo sa loob ng website.",
        number: "Executive Order Blg. 01, Serye ng 2026",
        date: "2026-01-01",
        icon: "📜",
        order: 1,
        published: true,
        content: "ISANG KAUTUSANG TAGAPAGPAGANAP NA NAGTATADHANA NG HALIMBAWANG PATAKARAN PARA SA PAMAHALAANG PANGLUNGSOD NG LOS SANTOS\n\nSa bisa ng kapangyarihang ipinagkaloob sa Punong Lungsod ng Los Santos, at alang-alang sa kapakanan at kaayusan ng mga mamamayan, ay ipinag-uutos ang sumusunod:\n\nSAPAGKAT, tungkulin ng Pamahalaang Panglungsod na magpatupad ng malinaw at makatarungang mga patakaran;\n\nSEKSYON 1. Layunin.\n\nAng kautusang ito ay nagsisilbing halimbawa ng buong dokumentong mababasa sa internal viewer ng Los Santos eGov."
      }
    ],

    Memorandums: [
      {
        title: "Halimbawang Memorandum",
        description: "Isang halimbawa ng memorandum na mababasa nang buo sa loob ng website.",
        number: "Memorandum Blg. 01, Serye ng 2026",
        date: "2026-01-02",
        icon: "📄",
        order: 1,
        published: true,
        content: "MEMORANDUM BLG. 01\nSerye ng 2026\n\nPAKSA: HALIMBAWANG MEMORANDUM PARA SA PAMAHALAANG PANGLUNGSOD\n\nIpinababatid sa lahat ng kinauukulan na ang dokumentong ito ay halimbawa ng memorandum na maaaring ilagay at basahin sa loob mismo ng Los Santos eGov.\n\nAng lahat ng tanggapan ay inaasahang makikipagtulungan sa maayos na pagpapatupad ng mga tagubiling nakasaad dito."
      }
    ],

    Resolutions: [
      {
        title: "Halimbawang Resolusyon",
        description: "Isang halimbawa ng resolusyong mababasa nang buo sa loob ng website.",
        number: "Resolusyon Blg. 01, Serye ng 2026",
        date: "2026-01-03",
        icon: "⚖️",
        order: 1,
        published: true,
        content: "RESOLUSYON BLG. 01\nSerye ng 2026\n\nISANG RESOLUSYONG NAGPAPATIBAY SA HALIMBAWANG PASYA NG PAMAHALAANG PANGLUNGSOD\n\nSAPAGKAT, kinakailangang maitala at mailathala nang maayos ang mga opisyal na pasya ng lungsod;\n\nIPINASIYA, gaya ng ipinapasiya ngayon, na gamitin ang Los Santos eGov bilang isa sa mga paraan ng pagpapalaganap ng mga opisyal na dokumento."
      }
    ]
  };

  Object.keys(starterData).forEach(function(section) {
    const sheet = getContentSheet_(section);

    if (sheet.getLastRow() > 1) return;

    starterData[section].forEach(function(item) {
      upsertRecord_(section, item);
    });
  });
}
