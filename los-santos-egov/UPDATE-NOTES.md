# Los Santos eGov V3 — Mga Pagbabago

## Internal reader para sa lahat ng dokumento

Pare-pareho na ang implementation ng:

- Executive Orders
- Mga Memorandum
- Mga Resolusyon

Kapag pinindot ang **Basahin ang Buong Dokumento**, magbubukas ang full-screen internal reader. May kasama itong pamagat, reference number, petsa, buong nilalaman, optional document cover, print button, optional signed PDF o Google Drive link, at shareable hash URL.

## Hiwalay na archive pages

Ang homepage ay nagpapakita lamang ng tig-tatlong pinakabagong dokumento.

Ang lahat ng records ay makikita sa:

- `executive-orders.html`
- `memorandums.html`
- `resolutions.html`

May search at pagination na tig-9 na dokumento bawat page.

## Tagalog interface

Isinalin sa natural na Tagalog ang homepage, navigation, buttons, search, pagination, empty at error messages, at admin dashboard.

## Image management

Sa admin dashboard, maaari nang palitan ang logo o selyo, hero background, larawan ng Punong Lungsod, default document cover, at larawan ng bawat form, anunsyo, at dokumento.

Gumagamit ito ng public image URL o public Google Drive share link.

## Required backend update

1. Palitan ang kasalukuyang Apps Script gamit ang bagong `google-apps-script/Code.gs`.
2. Patakbuhin muli ang `setupSheets()`.
3. I-update ang Apps Script deployment.
4. I-upload ang lahat ng bagong website files sa GitHub.

Hindi buburahin ng migration ang kasalukuyang records.
