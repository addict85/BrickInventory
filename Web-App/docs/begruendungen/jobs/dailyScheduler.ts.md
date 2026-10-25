# Begründungen zu `jobs/dailyScheduler.ts`

Die ausführlichen Kommentare aus `jobs/dailyScheduler.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Zeitplaner für TÄGLICHE Jobs mit im Monitoring konfigurierbarer Uhrzeit (HH:MM).

- Uhrzeiten liegen in global_settings unter `job_time_<name>` (Fallback = default).
- Läuft nur im Primary-Worker (dort werden die Jobs registriert).
- Änderungen greifen SOFORT: die API setzt ein DB-Flag `job_reschedule_trigger`,
  das der Primary hier alle 3s pollt und dann alles neu plant. Zusätzlich ruft
  die API rescheduleAll() direkt auf (falls die Anfrage auf dem Primary landet).
```
