# Los Santos eGov V6.6 — Automatic Numbering, Sorting, at Pinned Announcements

## Automatic numbering

Sa unang pag-publish ng bagong Executive Order, memorandum, o resolusyon, awtomatikong itatalaga ang kasunod na numero:

- `Executive Order Blg. 08, Serye ng 2026`
- `Memorandum Blg. 2026-03`
- `Resolusyon Blg. 06, Serye ng 2026`

Magkahiwalay ang sequence ng bawat uri at bawat taon. Hindi nire-recycle ang numero kapag may binurang record. Hindi rin binabago ang numero kapag in-edit o ginawang draft muli ang isang published document.

May manual override sa Admin Dashboard: alisin ang check sa awtomatikong numbering at ilagay ang kumpletong numero.

## Sorting

May dropdown na sa archive page ng Executive Orders, Mga Memorandum, at Mga Resolusyon:

- Pinakabago
- Pinakaluma
- Numero — Pataas
- Numero — Pababa

## Pinned announcements

Sa Mga Anunsyo, maaari nang:

- I-pin bilang mahalagang anunsyo
- Magtakda ng pin order mula 1 hanggang 3
- Magtakda ng optional expiration date

Ang mga aktibong pinned announcement ay gold/cream ang card at nauuna sa homepage at announcements archive. Hanggang tatlo lamang ang maaaring aktibong naka-pin.

## Installation

### GitHub

I-upload at palitan ang lahat ng files sa patch maliban sa `google-apps-script/Code.gs`, na para sa Apps Script editor.

### Google Apps Script

1. Palitan ang lumang `Code.gs`.
2. Save.
3. Patakbuhin ang `setupSheets()`.
4. Deploy → Manage deployments → Edit → New version → Deploy.

Ang `setupSheets()` ay magdadagdag ng bagong columns at hidden `Numbering` sheet. Hindi nito buburahin ang existing records.
