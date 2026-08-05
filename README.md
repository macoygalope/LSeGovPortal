# Los Santos eGov — GitHub Pages + Google Sheets CMS

Isang responsive na website para sa Pamahalaang Panglungsod ng Los Santos. Gumagamit ito ng GitHub Pages para sa public website at Google Sheets + Apps Script bilang simpleng backend.

## Pangunahing feature

- Mga pampublikong Google Form links
- Mga anunsyo
- Internal full-document reader para sa:
  - Executive Orders
  - Mga Memorandum
  - Mga Resolusyon
- Hiwalay na archive page para sa bawat uri ng dokumento
- Search at pagination sa archive pages
- Tig-tatlong pinakabagong dokumento lamang sa homepage
- Admin dashboard para sa pagdagdag, pag-edit, pag-publish, at pagtanggal
- Image management gamit ang public image URLs o Google Drive share links
- Mobile at desktop responsive layout
- Print-ready internal document view

## Mga page

- `index.html` — pangunahing pahina
- `executive-orders.html` — lahat ng Executive Orders
- `memorandums.html` — lahat ng memorandum
- `resolutions.html` — lahat ng resolusyon
- `admin.html` — pribadong content dashboard

## Mga image na maaaring palitan sa dashboard

Sa tab na **Mga Larawan at Ayos**, maaaring palitan ang:

- Logo o selyo
- Larawan ng Punong Lungsod
- Background ng hero section
- Default na larawan ng dokumento
- Pangalan at subtitle ng portal
- Pangunahing headline at description
- Pangalan ng Punong Lungsod
- Footer text

May sarili ring **Link ng Larawan** field ang bawat form, anunsyo, Executive Order, memorandum, at resolusyon.

> Dapat naka-public ang image link. Suportado ang normal na direct image URL at public Google Drive share link.

---

# Pag-set up ng Google Sheets backend

## 1. Gumawa ng Google Sheet

1. Gumawa ng bagong blank Google Sheet.
2. Buksan ang **Extensions → Apps Script**.
3. Burahin ang sample code.
4. I-paste ang laman ng `google-apps-script/Code.gs`.
5. I-save ang project.
6. Piliin ang function na `setupSheets`.
7. Pindutin ang **Run** at aprubahan ang permissions.

Awtomatikong gagawin o ia-update ng script ang mga tab na ito:

- `Forms`
- `Announcements`
- `ExecutiveOrders`
- `Memorandums`
- `Resolutions`
- `Settings`

Hindi buburahin ng `setupSheets()` ang kasalukuyang records. Idaragdag lamang nito ang mga bagong column na kulang, gaya ng `image` at `content`.

## 2. Magtakda ng admin token

Sa Apps Script editor, patakbuhin nang isang beses:

```javascript
setAdminToken("ILAGAY_DITO_ANG_MAHABA_AT_LIHIM_NA_TOKEN")
```

Gumamit ng token na hindi bababa sa 16 characters. Huwag ilagay ang token sa public GitHub files.

## 3. I-deploy bilang Web App

1. Pindutin ang **Deploy → New deployment**.
2. Piliin ang **Web app**.
3. **Execute as:** Me
4. **Who has access:** Anyone
5. Pindutin ang **Deploy**.
6. Kopyahin ang URL na nagtatapos sa `/exec`.

Sa `config.js`, palitan ang:

```javascript
API_URL: "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE"
```

ng iyong Apps Script `/exec` URL.

Kapag binago ang `Code.gs`, i-update ang deployment at gumawa ng bagong version.

---

# Paggamit ng Admin Dashboard

Buksan ang:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY/admin.html
```

Ilagay ang admin token.

## Para sa mga dokumento

Sa Executive Orders, Memorandums, at Resolutions:

- **Pamagat** — pangalan ng dokumento
- **Maikling Paglalarawan** — summary na makikita sa card
- **Buong Nilalaman ng Dokumento** — buong tekstong mababasa sa internal reader
- **Numero o Sanggunian** — halimbawa: `Executive Order Blg. 07, Serye ng 2026`
- **Petsa**
- **Link ng Larawan** — optional document cover
- **External Link** — optional signed PDF o Google Drive file
- **Ayos ng Pagkakasunod**
- **Ilathala sa website**

Sinusuportahan ang mahahabang dokumento hanggang 45,000 characters. Awtomatikong hinahati ng dashboard ang upload para hindi lumampas sa Apps Script URL limit.

---

# Pag-publish sa GitHub Pages

1. Gumawa ng GitHub repository.
2. I-upload ang lahat ng files at folders.
3. I-commit ang changes.
4. Buksan ang **Settings → Pages**.
5. Piliin:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
6. I-save.

Public website:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY/
```

---

# Mahalagang tala sa seguridad

Ang dashboard ay gumagamit ng pribadong token at JSONP requests para makakonekta ang GitHub Pages sa Google Apps Script.

Ang setup na ito ay praktikal para sa GTA RP community website, ngunit ang sinumang makaalam ng admin URL at token ay maaaring mag-edit ng content. Gumamit ng mahaba at lihim na token, at huwag ilagay ang `admin.html` link sa public navigation.

Para sa mas mataas na antas ng seguridad, kailangang gumamit ng Google OAuth o account-based Apps Script web application.

---

# Local preview

Sa project folder:

```bash
python -m http.server 8000
```

Pagkatapos ay buksan:

```text
http://localhost:8000
```

Kapag hindi pa nailalagay ang Apps Script URL, preview content muna ang ipapakita ng website.
