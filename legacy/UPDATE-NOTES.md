# Los Santos eGov V6.8 — Global Loading & Fetch State

## Ano ang bago

Lahat ng public pages ay may branded loading screen habang kinukuha ang data mula sa Google Sheets / Apps Script backend:

- Homepage
- Mga Anunsyo
- Executive Orders
- Mga Resolusyon
- Hidden na Mga Memorandum archive
- Individual memorandum page

Hindi muna ipinapakita ang page content, record counts, empty states, sorting, o cards hangga't hindi kumpleto ang initial database fetch.

## Kapag mabagal o pumalya ang backend

Pagkalipas ng humigit-kumulang 12 segundo na walang maayos na response, hindi na magpapakita ng misleading sample records. Sa halip ay lalabas ang malinaw na error state na may:

- “Hindi makuha ang mga tala”
- paliwanag tungkol sa database connection
- **Subukan Muli** button

Hindi kailangang i-refresh ang buong browser para mag-retry.

## Smooth loading

May minimum na humigit-kumulang 550ms display time ang loader para hindi ito mag-flicker kapag mabilis ang database response. Pagkatapos ma-render ang tunay na records, saka lamang magfa-fade out ang loading screen.

## Local development

Ang bundled preview/sample records ay ginagamit lamang kapag local/file preview ang website at hindi configured ang backend. Sa GitHub Pages/production, database failure = error/retry state, hindi sample content.

## Admin Dashboard

- Kapag walang saved admin token, agad na lalabas ang login page.
- Kapag may existing session token, mananatili muna ang boot cover habang bine-verify ang admin access at kinukuha ang initial records.
- Ang pagpalit ng admin sections ay gumagamit pa rin ng localized “Kinukuha ang mga record…” state para hindi unnecessary na i-lock ang buong dashboard.

## Retained V6.7 behavior

Kasama pa rin ang Forms Detail Pop-out:

Form card → instructions/detail pop-out → **Buksan ang Form** → external Google Form.

## Backend

Walang Google Sheet migration at walang Code.gs update na kailangan para sa V6.8.
