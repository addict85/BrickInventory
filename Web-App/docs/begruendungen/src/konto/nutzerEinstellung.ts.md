# Begründungen zu `src/konto/nutzerEinstellung.ts`

Die ausführlichen Kommentare aus `src/konto/nutzerEinstellung.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="setusersetting"></a>
## `setUserSetting`

```text
User-Einstellung schreiben — die EINE Stelle für alle drei Schreibwege
(Webapp-Formular, Einstellungs-Import, /api/v1).

── Warum es diesen Helfer gibt ─────────────────────────────────────────────
Der Preis-Cache ist über set_number + condition + currency_code
verschlüsselt. Wer die Währung wechselt, hat ab diesem Moment für JEDES Set
einen Cache-Fehlschlag — und die Bewertung versucht dann je Set einen
Live-Abruf bei BrickLink, im Anfragepfad. Im Lastprofil (Nachtrag 27b):
21 Sekunden statt 53 Millisekunden für den Finanzreiter, dazu geht jeder
dieser Abrufe auf das Tageskontingent.

Der Cache füllt sich zwar von selbst wieder, aber erst Abruf für Abruf beim
Ansehen — oder beim nächsten planmässigen Preislauf, der bis zu
price_job_interval_minutes entfernt ist. Deshalb: Ändert sich die WÄHRUNG
tatsächlich (nicht bei jedem Speichern der Einstellungsseite — das Formular
schickt immer alle Felder), wird der Preis-Job sofort angestossen.
runPriceRefresh() liest je Nutzer die Währung, holt nur, was im Cache fehlt,
und triggerNow() hält die Sperre 55 selbst — mehrfaches Anstossen ist
dadurch harmlos, egal in welchem Worker das hier läuft.

setImmediate + spätes require: Die Antwort auf das Speichern wartet nicht
auf den Preislauf, und src/einstellungen/settings ↔ jobs/priceJob bilden keinen
Import-Kreis.

@param {number|string} userId
@param {string} key
@param {string} value
```
