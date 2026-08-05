const CONFIG = window.EGOV_CONFIG || {};
const API_URL = CONFIG.API_URL || "";

const EGOV_SECTIONS = ["Forms", "Announcements", "ExecutiveOrders", "Memorandums", "Resolutions"];
const EGOV_DOCUMENT_SECTIONS = ["Announcements", "ExecutiveOrders", "Memorandums", "Resolutions"];

const EGOV_LABELS = {
  Announcements: {
    singular: "Anunsyo",
    plural: "Mga Anunsyo",
    empty: "Wala pang anunsyong nailalathala.",
    searchEmpty: "Walang anunsyong tumutugma sa iyong paghahanap.",
    countSingular: "anunsyo",
    countPlural: "mga anunsyo",
    readAction: "Basahin ang Buong Anunsyo →",
    externalAction: "Buksan ang Kaugnay na Link ↗",
    noContent: "Wala pang buong nilalaman",
    defaultDescription: "Basahin ang buong anunsyo para sa kumpletong detalye."
  },
  ExecutiveOrders: {
    singular: "Executive Order",
    plural: "Executive Orders",
    empty: "Wala pang Executive Order na nailalathala.",
    searchEmpty: "Walang Executive Order na tumutugma sa iyong paghahanap.",
    countSingular: "dokumento",
    countPlural: "mga dokumento",
    readAction: "Basahin ang Buong Dokumento →",
    externalAction: "Buksan ang Nilagdaang Kopya ↗",
    noContent: "Wala pang buong nilalaman",
    defaultDescription: "Basahin ang buong dokumento para sa kumpletong detalye."
  },
  Memorandums: {
    singular: "Memorandum",
    plural: "Mga Memorandum",
    empty: "Wala pang memorandum na nailalathala.",
    searchEmpty: "Walang memorandum na tumutugma sa iyong paghahanap.",
    countSingular: "dokumento",
    countPlural: "mga dokumento",
    readAction: "Basahin ang Buong Dokumento →",
    externalAction: "Buksan ang Nilagdaang Kopya ↗",
    noContent: "Wala pang buong nilalaman",
    defaultDescription: "Basahin ang buong dokumento para sa kumpletong detalye."
  },
  Resolutions: {
    singular: "Resolusyon",
    plural: "Mga Resolusyon",
    empty: "Wala pang resolusyon na nailalathala.",
    searchEmpty: "Walang resolusyong tumutugma sa iyong paghahanap.",
    countSingular: "dokumento",
    countPlural: "mga dokumento",
    readAction: "Basahin ang Buong Dokumento →",
    externalAction: "Buksan ang Nilagdaang Kopya ↗",
    noContent: "Wala pang buong nilalaman",
    defaultDescription: "Basahin ang buong dokumento para sa kumpletong detalye."
  }
};

const EGOV_FALLBACK = {
  SiteSettings: {
    siteTitle: "Los Santos eGov",
    siteSubtitle: "Opisyal na Portal ng Serbisyong Digital",
    heroTitle: "Mga serbisyo, dokumento, at pabatid ng lungsod—nasa iisang lugar.",
    heroDescription: "Buksan ang mga opisyal na form, basahin ang mahahalagang anunsyo, at tingnan ang mga dokumentong inilabas ng Pamahalaang Panglungsod.",
    heroImageUrl: "",
    logoUrl: "",
    mayorImageUrl: "",
    mayorName: "Hon. Alejandro Tagalog",
    meetingButtonLabel: "Makipagpulong kay Mayor",
    meetingUrl: "",
    defaultDocumentImageUrl: "",
    defaultSignatureImageUrl: "",
    defaultSignatoryName: "Alejandro Tagalog",
    defaultSignatoryPosition: "Alkalde ng Lungsod ng Los Santos",
    footerText: "© Pamahalaang Panglungsod ng Los Santos. Lahat ng karapatan ay nakalaan."
  },
  Forms: [
    { id: "form-1", title: "OOC Talk Forms", description: "Magsumite ng opisyal na OOC concern o kahilingan.", url: "#", icon: "💬", image: "", published: true, order: 1 },
    { id: "form-2", title: "Vehicle Registration Form", description: "Iparehistro ang sasakyan sa Pamahalaang Panglungsod.", url: "#", icon: "🚘", image: "", published: true, order: 2 },
    { id: "form-3", title: "Business Registration / Update Form", description: "Magparehistro ng negosyo o mag-update ng kasalukuyang business record.", url: "#", icon: "🏪", image: "", published: true, order: 3 },
    { id: "form-4", title: "Organization Application", description: "Magsumite ng aplikasyon para sa opisyal na pagkilala sa isang organisasyon.", url: "#", icon: "👥", image: "", published: true, order: 4 }
  ],
  Announcements: [
    {
      id: "announcement-1",
      title: "Maligayang Pagdating sa Los Santos eGov",
      description: "Maaari nang ma-access sa portal na ito ang mga anunsyo, proyekto, kaganapan, pampublikong form, at opisyal na dokumento ng lungsod.",
      number: "Pabatid mula sa Tanggapan ng Punong Lungsod",
      date: "2026-08-05",
      url: "",
      icon: "📢",
      image: "",
      published: true,
      order: 1,
      content: "## Maligayang Pagdating sa Los Santos eGov\n\nDito ilalathala ang mahahalagang **anunsyo**, mga kasalukuyang *proyekto*, at mga nalalapit na kaganapan ng Tanggapan ng Punong Lungsod.\n\n- Mga programa at proyekto ng lungsod\n- Mga pampublikong kaganapan\n- Mga paalala at opisyal na pabatid\n\nAbangan ang mga susunod na update mula sa Pamahalaang Panglungsod ng Los Santos."
    }
  ],
  ExecutiveOrders: [
    {
      id: "eo-1",
      title: "Halimbawang Executive Order",
      description: "Isang halimbawa ng dokumentong mababasa nang buo sa loob ng website.",
      number: "Executive Order Blg. 01, Serye ng 2026",
      date: "2026-01-01",
      url: "",
      icon: "📜",
      image: "",
      order: 1,
      published: true,
      content: "ISANG KAUTUSANG TAGAPAGPAGANAP NA NAGTATADHANA NG HALIMBAWANG PATAKARAN PARA SA PAMAHALAANG PANGLUNGSOD NG LOS SANTOS\n\nSa bisa ng kapangyarihang ipinagkaloob sa Punong Lungsod ng Los Santos, at alang-alang sa kapakanan at kaayusan ng mga mamamayan, ay ipinag-uutos ang sumusunod:\n\nSAPAGKAT, tungkulin ng Pamahalaang Panglungsod na magpatupad ng malinaw at makatarungang mga patakaran;\n\nSEKSYON 1. Layunin.\n\nAng kautusang ito ay nagsisilbing halimbawa ng buong dokumentong mababasa sa internal viewer ng Los Santos eGov."
    }
  ],
  Memorandums: [
    {
      id: "memo-1",
      title: "Pagsusumite ng Ulat ng mga Tanggapan",
      subject: "Pagsusumite ng Ulat ng mga Tanggapan",
      memoTo: "Mga Hepe at Kinatawan ng mga Ahensiya ng Pamahalaang Panglungsod",
      memoFrom: "Tanggapan ng Alkalde",
      watermarkImage: "",
      signatureImage: "",
      signatoryName: "Alejandro Tagalog",
      signatoryPosition: "Alkalde ng Lungsod ng Los Santos",
      description: "Halimbawang pormal na memorandum para sa mga tanggapan ng Pamahalaang Panglungsod.",
      number: "Memorandum Blg. 2026-01",
      date: "2026-01-02",
      url: "",
      icon: "📄",
      image: "",
      order: 1,
      published: true,
      content: "Alinsunod sa layunin ng Pamahalaang Panglungsod na mapanatili ang maayos na koordinasyon sa pagitan ng mga tanggapan, ang lahat ng kinauukulang ahensiya ay inaasahang magsumite ng kanilang opisyal na ulat sa itinakdang panahon.\n\nAng ulat ay kinakailangang maglaman ng mga sumusunod:\n\n- Buod ng mga isinagawang aktibidad;\n- Mga suliraning kinaharap ng tanggapan;\n- Mga mungkahi at rekomendasyon; at\n- Mga susunod na hakbang para sa mas maayos na serbisyo.\n\nMahigpit na ipatutupad ang tagubiling ito para sa kapakanan ng buong lungsod."
    }
  ],
  Resolutions: [
    {
      id: "resolution-1",
      title: "Halimbawang Resolusyon",
      description: "Isang halimbawa ng resolusyong mababasa nang buo sa loob ng website.",
      number: "Resolusyon Blg. 01, Serye ng 2026",
      date: "2026-01-03",
      url: "",
      icon: "⚖️",
      image: "",
      order: 1,
      published: true,
      content: "RESOLUSYON BLG. 01\nSerye ng 2026\n\nISANG RESOLUSYONG NAGPAPATIBAY SA HALIMBAWANG PASYA NG PAMAHALAANG PANGLUNGSOD\n\nSAPAGKAT, kinakailangang maitala at mailathala nang maayos ang mga opisyal na pasya ng lungsod;\n\nIPINASIYA, gaya ng ipinapasiya ngayon, na gamitin ang Los Santos eGov bilang isa sa mga paraan ng pagpapalaganap ng mga opisyal na dokumento."
    }
  ]
};

window.Egov = (() => {
  let viewerPreviousHash = "";

  function isConfigured() {
    return API_URL && !API_URL.includes("PASTE_YOUR");
  }

  function jsonp(params, timeoutMs = 18000) {
    return new Promise((resolve, reject) => {
      if (!isConfigured()) {
        reject(new Error("Hindi pa nakakabit ang Google Sheets backend."));
        return;
      }

      const callbackName = `egovCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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
        if (payload && payload.ok === false) reject(new Error(payload.error || "Hindi naisagawa ang kahilingan."));
        else resolve(payload);
      };

      const query = new URLSearchParams({ ...params, callback: callbackName, _: Date.now().toString() });
      script.src = `${API_URL}?${query.toString()}`;
      script.onerror = () => {
        cleanup();
        reject(new Error("Hindi makakonekta sa Google Sheets."));
      };
      document.body.appendChild(script);
    });
  }

  async function loadAll() {
    try {
      if (!isConfigured()) throw new Error("Preview mode");
      const result = await jsonp({ action: "all" });
      const data = result.data || {};
      EGOV_SECTIONS.forEach((section) => {
        if (!Array.isArray(data[section])) data[section] = [];
      });
      data.SiteSettings = data.SiteSettings || {};
      return data;
    } catch (error) {
      console.warn(error.message);
      showToast(isConfigured()
        ? "Hindi makuha ang Google Sheet. Preview content muna ang ipinapakita."
        : "Preview mode: ilagay ang Apps Script URL sa config.js.");
      return JSON.parse(JSON.stringify(EGOV_FALLBACK));
    }
  }

  function published(items) {
    return (Array.isArray(items) ? items : [])
      .filter((item) => item.published === true || String(item.published).toLowerCase() === "true")
      .sort((a, b) => {
        const orderDiff = Number(a.order || 0) - Number(b.order || 0);
        if (orderDiff !== 0) return orderDiff;
        return String(b.date || "").localeCompare(String(a.date || ""));
      });
  }

  function newest(items) {
    return published(items).sort((a, b) => {
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return Number(a.order || 0) - Number(b.order || 0);
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

  function safeUrl(url) {
    if (!url || url === "#") return "#";
    try {
      const parsed = new URL(String(url).trim());
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "#";
    } catch {
      return "#";
    }
  }

  function imageUrl(url) {
    const clean = safeUrl(url);
    if (clean === "#") return "";

    const fileMatch = clean.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (fileMatch) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileMatch[1])}&sz=w1600`;

    try {
      const parsed = new URL(clean);
      if (parsed.hostname.includes("drive.google.com")) {
        const id = parsed.searchParams.get("id");
        if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;
      }
    } catch {}

    return clean;
  }

  function linkAttributes(url) {
    const clean = safeUrl(url);
    if (clean === "#") return `href="#" data-placeholder-link="true"`;
    return `href="${escapeHtml(clean)}" target="_blank" rel="noopener noreferrer"`;
  }

  const monthNames = [
    "Enero", "Pebrero", "Marso", "Abril", "Mayo", "Hunyo",
    "Hulyo", "Agosto", "Setyembre", "Oktubre", "Nobyembre", "Disyembre"
  ];

  function formatDate(dateValue) {
    if (!dateValue) return "Walang nakatalang petsa";
    const date = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(date.getTime())) return escapeHtml(dateValue);
    return `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  }

  function dateParts(dateValue) {
    const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
    const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
    return {
      day: String(validDate.getDate()).padStart(2, "0"),
      month: monthNames[validDate.getMonth()].slice(0, 3),
      year: validDate.getFullYear()
    };
  }

  /**
   * Ligtas na subset ng Markdown para sa mahahabang opisyal na dokumento.
   * Sinusuportahan: headings, bold, italic, links, blockquote,
   * bullet list, numbered list, at horizontal separator.
   */
  function documentContentToHtml(content) {
    const normalized = String(content || "").replace(/\r\n?/g, "\n").trim();
    if (!normalized) return `<p>Wala pang nailalathalang buong nilalaman.</p>`;

    function formatInline(text) {
      let formatted = escapeHtml(text);

      // Link: [Pangalan](https://example.com)
      formatted = formatted.replace(
        /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (_match, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
      );

      // ***Bold at italic*** o ___Bold at italic___
      formatted = formatted
        .replace(/\*\*\*([^*\n]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/___([^_\n]+?)___/g, "<strong><em>$1</em></strong>");

      // **Bold** o __Bold__
      formatted = formatted
        .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");

      // *Italic* o _Italic_. Iniiwasang galawin ang underscore sa gitna ng salita.
      formatted = formatted
        .replace(/(^|[\s([{>])\*([^*\n]+?)\*(?=$|[\s.,;:!?)}\]<>])/g, "$1<em>$2</em>")
        .replace(/(^|[\s([{>])_([^_\n]+?)_(?=$|[\s.,;:!?)}\]<>])/g, "$1<em>$2</em>");

      return formatted;
    }

    function paragraphClasses(plainText) {
      const classes = [];
      const comparableText = plainText.replace(/^[*_`~\s]+/, "");
      if (/^(SEKSYON|SECTION|ARTIKULO|ARTICLE|KABANATA|CHAPTER|PAKSA|SUBJECT)\b/i.test(comparableText)) {
        classes.push("document-section-title");
      }
      if (/^(SAPAGKAT|IPINASIYA|IPINAG-UUTOS|NOW, THEREFORE|WHEREAS|RESOLVED)\b/i.test(comparableText)) {
        classes.push("document-clause");
      }
      return classes.length ? ` class="${classes.join(" ")}"` : "";
    }

    const lines = normalized.split("\n");
    const html = [];
    let paragraph = [];
    let listType = "";
    let listItems = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      const plain = paragraph.join("\n").trim();
      if (plain) {
        html.push(`<p${paragraphClasses(plain)}>${paragraph.map(formatInline).join("<br>")}</p>`);
      }
      paragraph = [];
    }

    function flushList() {
      if (!listType || !listItems.length) return;
      const tag = listType === "ordered" ? "ol" : "ul";
      html.push(`<${tag} class="document-list">${listItems.map((item) => `<li>${formatInline(item)}</li>`).join("")}</${tag}>`);
      listType = "";
      listItems = [];
    }

    function startOrContinueList(type, item) {
      flushParagraph();
      if (listType && listType !== type) flushList();
      listType = type;
      listItems.push(item.trim());
    }

    lines.forEach((rawLine) => {
      const line = rawLine.replace(/\s+$/, "");
      const trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        flushList();
        return;
      }

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(heading[1].length + 1, 4);
        html.push(`<h${level} class="document-markdown-heading">${formatInline(heading[2])}</h${level}>`);
        return;
      }

      if (/^(---|___)\s*$/.test(trimmed)) {
        flushParagraph();
        flushList();
        html.push(`<hr class="document-divider">`);
        return;
      }

      const unordered = line.match(/^\s*[-+]\s+(.+)$/);
      if (unordered) {
        startOrContinueList("unordered", unordered[1]);
        return;
      }

      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ordered) {
        startOrContinueList("ordered", ordered[1]);
        return;
      }

      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        flushList();
        html.push(`<blockquote class="document-quote">${formatInline(quote[1])}</blockquote>`);
        return;
      }

      flushList();
      paragraph.push(trimmed);
    });

    flushParagraph();
    flushList();
    return html.join("");
  }

  function cardMedia(item, fallbackImage, fallbackIcon = "📄") {
    const source = imageUrl(item.image || fallbackImage);
    if (source) {
      return `<div class="card-media"><img src="${escapeHtml(source)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('image-error');this.remove()"><span>${escapeHtml(item.icon || fallbackIcon)}</span></div>`;
    }
    return `<div class="card-media image-error"><span>${escapeHtml(item.icon || fallbackIcon)}</span></div>`;
  }

  function renderDocumentCards(items, section, fallbackImage = "") {
    const label = EGOV_LABELS[section] || { singular: "Dokumento" };
    return items.map((item) => {
      const hasInternal = Boolean(String(item.content || "").trim());
      const hasExternal = safeUrl(item.url) !== "#";
      let action = `<span class="no-file">${escapeHtml(label.noContent || "Wala pang buong nilalaman")}</span>`;

      if (hasInternal && section === "Memorandums") {
        action = `<a class="document-open-button" href="memorandum.html?id=${encodeURIComponent(item.id)}">${escapeHtml(label.readAction || "Basahin ang Buong Dokumento →")}</a>`;
      } else if (hasInternal) {
        action = `<button class="document-open-button" type="button" data-open-document data-section="${escapeHtml(section)}" data-id="${escapeHtml(item.id)}">${escapeHtml(label.readAction || "Basahin ang Buong Dokumento →")}</button>`;
      } else if (hasExternal) {
        action = `<a ${linkAttributes(item.url)}>${escapeHtml(label.externalAction || "Buksan ang Kaugnay na Link ↗")}</a>`;
      }

      return `
        <article class="document-card" data-search="${escapeHtml(`${item.title} ${item.description} ${item.number} ${item.content || ""}`.toLowerCase())}">
          ${cardMedia(item, fallbackImage, "📄")}
          <div class="document-card-body">
            <div class="document-topline">
              <span class="document-badge">${escapeHtml(label.singular)}</span>
            </div>
            <p class="document-number">${escapeHtml(item.number || label.singular)}</p>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.description || label.defaultDescription || "Basahin ang buong nilalaman para sa kumpletong detalye.")}</p>
            <div class="document-meta">
              <span>${formatDate(item.date)}</span>
              ${action}
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function applySettings(settings = {}) {
    const merged = { ...EGOV_FALLBACK.SiteSettings, ...settings };

    document.querySelectorAll("[data-site-title]").forEach((el) => el.textContent = merged.siteTitle);
    document.querySelectorAll("[data-site-subtitle]").forEach((el) => el.textContent = merged.siteSubtitle);
    document.querySelectorAll("[data-hero-title]").forEach((el) => el.textContent = merged.heroTitle);
    document.querySelectorAll("[data-hero-description]").forEach((el) => el.textContent = merged.heroDescription);
    document.querySelectorAll("[data-mayor-name]").forEach((el) => el.textContent = merged.mayorName);
    document.querySelectorAll("[data-footer-text]").forEach((el) => el.textContent = merged.footerText);

    const meetingUrl = safeUrl(merged.meetingUrl);
    const meetingLabel = String(merged.meetingButtonLabel || "Makipagpulong kay Mayor").trim() || "Makipagpulong kay Mayor";
    document.querySelectorAll("[data-meeting-link]").forEach((link) => {
      link.textContent = meetingLabel;
      if (meetingUrl !== "#") {
        link.href = meetingUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.classList.remove("hidden");
      } else {
        link.removeAttribute("href");
        link.classList.add("hidden");
      }
    });

    const viewerMayor = document.getElementById("viewerMayorName");
    if (viewerMayor) viewerMayor.textContent = merged.mayorName;

    const logo = imageUrl(merged.logoUrl);
    document.querySelectorAll("[data-logo-holder]").forEach((holder) => {
      if (logo) {
        holder.innerHTML = `<img src="${escapeHtml(logo)}" alt="Selyo ng Los Santos">`;
        holder.classList.add("has-image");
      } else {
        holder.textContent = "LS";
        holder.classList.remove("has-image");
      }
    });

    const hero = document.getElementById("heroSection");
    const heroImage = imageUrl(merged.heroImageUrl);
    if (hero && heroImage) {
      hero.style.setProperty("--hero-image", `url("${heroImage.replaceAll('"', '\\"')}")`);
      hero.classList.add("has-custom-image");
    }

    const mayorImage = document.getElementById("mayorImage");
    const mayorFallback = document.getElementById("mayorFallback");
    const mayorUrl = imageUrl(merged.mayorImageUrl);
    if (mayorImage && mayorUrl) {
      mayorImage.src = mayorUrl;
      mayorImage.classList.remove("hidden");
      if (mayorFallback) mayorFallback.classList.add("hidden");
      mayorImage.onerror = () => {
        mayorImage.classList.add("hidden");
        if (mayorFallback) mayorFallback.classList.remove("hidden");
      };
    }

    document.title = document.title.replace("Los Santos eGov", merged.siteTitle || "Los Santos eGov");
    return merged;
  }

  function initNavigation() {
    const menuButton = document.getElementById("menuButton");
    const siteNav = document.getElementById("siteNav");
    if (!menuButton || !siteNav) return;

    menuButton.addEventListener("click", () => {
      const open = siteNav.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(open));
    });

    siteNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      siteNav.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
    }));
  }

  function findDocument(data, section, id) {
    if (!data || !Array.isArray(data[section])) return null;
    return published(data[section]).find((item) => String(item.id) === String(id)) || null;
  }

  function initViewer(data, settings = {}) {
    const viewer = document.getElementById("documentViewer");
    if (!viewer) return;

    function openDocument(section, id, updateHistory = true) {
      const item = findDocument(data, section, id);
      if (!item || (!String(item.content || "").trim() && safeUrl(item.url) === "#")) return;

      if (!String(item.content || "").trim() && safeUrl(item.url) !== "#") {
        window.open(safeUrl(item.url), "_blank", "noopener,noreferrer");
        return;
      }

      const label = EGOV_LABELS[section] || { singular: "Opisyal na Dokumento" };
      const externalLink = document.getElementById("viewerExternalLink");
      const viewerImage = document.getElementById("viewerImage");

      document.getElementById("viewerCategory").textContent = label.singular;
      document.getElementById("viewerNumber").textContent = item.number || label.singular;
      document.getElementById("viewerTitle").textContent = item.title || "Opisyal na Dokumento";
      document.getElementById("viewerDate").textContent = formatDate(item.date);
      document.getElementById("viewerContent").innerHTML = documentContentToHtml(item.content);
      document.getElementById("viewerMayorName").textContent = settings.mayorName || EGOV_FALLBACK.SiteSettings.mayorName;

      const cover = imageUrl(item.image || settings.defaultDocumentImageUrl);
      if (cover) {
        viewerImage.src = cover;
        viewerImage.alt = `Larawan para sa ${item.title}`;
        viewerImage.classList.remove("hidden");
        viewerImage.onerror = () => viewerImage.classList.add("hidden");
      } else {
        viewerImage.removeAttribute("src");
        viewerImage.classList.add("hidden");
      }

      const externalUrl = safeUrl(item.url);
      externalLink.textContent = label.externalAction || "Buksan ang Kaugnay na Link ↗";
      if (externalUrl !== "#") {
        externalLink.href = externalUrl;
        externalLink.classList.remove("hidden");
      } else {
        externalLink.removeAttribute("href");
        externalLink.classList.add("hidden");
      }

      viewer.classList.add("open");
      viewer.setAttribute("aria-hidden", "false");
      document.body.classList.add("viewer-open");
      document.getElementById("closeDocumentViewer").focus();

      if (updateHistory) {
        viewerPreviousHash = window.location.hash && !window.location.hash.startsWith("#document=")
          ? window.location.hash
          : "";
        history.pushState({ documentViewer: true }, "", `#document=${encodeURIComponent(section)}&id=${encodeURIComponent(id)}`);
      }
    }

    function closeDocument(updateHistory = true) {
      if (!viewer.classList.contains("open")) return;
      viewer.classList.remove("open");
      viewer.setAttribute("aria-hidden", "true");
      document.body.classList.remove("viewer-open");

      if (updateHistory && window.location.hash.startsWith("#document=")) {
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}${viewerPreviousHash}`);
      }
    }

    function openFromHash() {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash.startsWith("document=")) return;
      const params = new URLSearchParams(hash);
      const section = params.get("document");
      const id = params.get("id");
      if (section && id) openDocument(section, id, false);
    }

    document.addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-open-document]");
      if (openButton) {
        openDocument(openButton.dataset.section, openButton.dataset.id);
        return;
      }
      if (event.target.closest("[data-close-viewer]")) closeDocument();
    });

    document.getElementById("closeDocumentViewer").addEventListener("click", () => closeDocument());
    document.getElementById("printDocumentButton").addEventListener("click", () => window.print());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDocument();
    });
    window.addEventListener("popstate", () => {
      if (window.location.hash.startsWith("#document=")) openFromHash();
      else closeDocument(false);
    });

    openFromHash();
  }

  function attachPlaceholderHandlers() {
    document.querySelectorAll("[data-placeholder-link='true']").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        showToast("Placeholder pa ang link na ito. Ilagay ang opisyal na URL sa admin dashboard.");
      });
    });
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 3800);
  }

  return {
    labels: EGOV_LABELS,
    fallback: EGOV_FALLBACK,
    loadAll,
    jsonp,
    published,
    newest,
    escapeHtml,
    safeUrl,
    imageUrl,
    linkAttributes,
    formatDate,
    dateParts,
    documentContentToHtml,
    cardMedia,
    renderDocumentCards,
    applySettings,
    initNavigation,
    initViewer,
    attachPlaceholderHandlers,
    showToast
  };
})();
