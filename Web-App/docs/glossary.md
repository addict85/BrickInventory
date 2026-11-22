# Glossary

One English term per concept in the server code, the database and the API v2.
The German term is what users see in the interface (and what older code,
migrations before 0127 and the API v1 still say).

| Concept (German, UI) | Code / DB / API v2 | Not |
|---|---|---|
| Auftrag | job | task, order |
| Auftragsart | job kind (`jobKind`, `jobKinds`; column `jobs.type`) | job type, art |
| Auftragsstatus | job status: `open`, `running`, `done`, `error`, `cancelled` | state |
| Erfassung | acquisition | entry, purchase |
| Bestand | holding (what an account owns) | stock, inventory |
| Vorrat (eines Lagerorts) | stock | holding |
| Lagerort | storage (location); table `storage_locations` | location, place |
| Zustand (N/U) | condition | state |
| Zustand (Lauf, Auftrag, Einrichtung) | state | condition |
| Merkliste / Merkposten | wanted list / wanted item | wishlist, notes |
| Gutschein / Guthaben | voucher / balance | gift card, credit |
| Haushalt | household | family |
| Haupt-/Unterkonto | main account / sub account | parent, child |
| Konto | account | user (a user is the person; `users` is the table) |
| Verwalter / Verwaltung | admin / management | administrator, manager |
| Kaufpreis | purchase price | cost, buy price |
| Marktpreis | market price | value |
| Währung | currency | |
| Figur | minifig | figure |
| Teil | part | piece (pieces = Teilezahl eines Sets) |
| Anleitung | instruction (PDF) | manual |
| Papierkorb | trash | bin, recycle |
| Sitzung / Keks | session / cookie | |
| Zweiter Faktor | second factor | 2FA, MFA |
| Gerät / Geräteschlüssel | device / device key | |
| Kopplung (QR) | pairing | linking |
| Zugang | access | login |
| Sicht (Datenbank) | view | |
| Blickfeld | scope (own account or household) | view, field of view |
| Zeilenschutz | row security (RLS) | row protection |
| Systemrahmen / Auftragsrahmen | system frame / job frame | context |
| Drossel / Kontingent / Takt | throttle / quota / tick | brake, limit |
| Vertrag (API) | contract | |
| Nutzlast | payload | |
| Uhr | clock (`clock.now()`) | time |
| Fortschritt (`erledigt`/`gesamt`) | progress (`done`/`total`) | |
| Nachladen | reload | refetch |
| Nachlauf | follow-up (run) | afterrun |
| Protokoll | log | protocol |
| Einstellungen | settings | config (config = environment, `config()`) |

Rules

- Identifiers, file names, database objects and API v2 use the right column.
- User-facing texts stay German (`public/locales/de.js`, mails, UI error texts).
- A new concept gets a row here before it gets a name in the code.
