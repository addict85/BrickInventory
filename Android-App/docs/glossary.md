# Glossary (Android code)

One English term per concept in identifiers, file names and comments. The German column
names the former code term; user-facing texts stay German in `values-de/strings.xml`.

| Term in code | Former German term | Meaning |
|---|---|---|
| account, sub-account, parent account | Konto, Unterkonto, Elternkonto | A user of the server; a household links accounts. |
| household | Haushalt | Accounts that share their collection. |
| area | Bereich | The local data compartment of one server and account. |
| stock | Bestand | What an account owns (sets, parts, figures) and its offline copy (tables `stock`, `stock_state`). |
| stock kind | Bestandsart / Art | Which list a stock row belongs to (`StockKind`, column `kind`). |
| outbox | Ausgang | Local queue of edits that still have to reach the server (table `outbox`); never "exit". |
| edit | Bearbeitung | One queued change in the outbox (`Editing`). |
| store | Ablage | Small persistent storage (DataStore, preferences, file); class suffix `Store`. |
| vault | Tresor | Keystore-backed encryption of a store. |
| outcome: success / failure | Ergebnis: Erfolg / Fehler | Result of a server call (`Outcome`), not `kotlin.Result`. |
| load | Laden | Loading state of a screen (`Load<T>`). |
| operation | Vorgang | A running user action with its result. |
| message | Meldung | A sentence for the user (snackbar, notification). |
| state / UI state | Zustand (eines Bildschirms) | What a screen shows (`…UiState`, `…States.kt`). |
| condition | Zustand (eines Teils) | New or used (`Condition.NEW`, `Condition.USED`). |
| login / logout | Anmeldung / Abmeldung | Signing in and out in code; the English UI text says "Sign in/out". |
| entry, record | Erfassung, erfassen | Adding an item (scan, typing in). |
| wanted list, wanted item | Merkliste, Merkposten | Sets an account wants to buy. |
| storage location | Lagerort | Where an item is kept. |
| price alarm | Preisalarm | Notification below or above a price threshold. |
| voucher, redemption | Gutschein, Entwertung | A voucher and its two-step redemption. |
| job | Auftrag | A background job of the server or the PDF export. |
| valuation | Bewertung | Market value of the stock. |
| spare part | Ersatzteil | A BrickLink spare part. |
| step approval, step guard | Schrittfreigabe, Schrittschutz | Confirmation of a sensitive step with the device key. |
| device lock, app lock | Gerätesperre, App-Sperre | Screen lock of the device; lock of the app itself. |
| view | Ansicht | UI model mapped from a contract type (`…View`). |
| mapping | Abbildung | Function from a contract type to a view (`asView`). |
| counter-check | Gegenprobe | Patch that breaks code on purpose; directory `counter-checks/`. |
| screenshot | Bildschirmfoto | Reference image of a screen; directory `app/src/test/screenshots/`. |

## Generated contract

`core-contract/ContractSets.kt` and one file per further OpenAPI tag are generated from API v2 (`Web-App/docs/openapi-v2.json`,
Web-App/scripts/contract-kotlin-dtos.js) and are English like the rest of the source;
`@SerialName` holds the wire names. `SourceRatchetTest` allows no German name, not even there.
