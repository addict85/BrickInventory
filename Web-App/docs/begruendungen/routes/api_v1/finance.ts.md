# Begründungen zu `routes/api_v1/finance.ts`

Die ausführlichen Kommentare aus `routes/api_v1/finance.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="get-finance-valuation"></a>
## Abschnitt

```text
── Kein `rate_limit` mehr in dieser Antwort ────────────────────────────

Hier stand `rate_limit: await getRateLimitStatus('bricklink')`, mit der
Begründung „wie in /api/finance/valuation (Parität) — die Webapp zeigt
damit den API-Verbrauch an". Beides stimmte nicht: routes/finance.ts hat
das Feld gar nicht, und was Einstellungsseite und Android anzeigen, ist
`rate_limits` (Plural) aus /v1/admin/cache-stats. Den Singular las kein
einziger Verbraucher — nachgemessen über beide Clients in diesem Ablagen.

Gekostet hat er drei Datenbankabfragen JE AUFRUF (gemessen, nicht
geschätzt: getRateLimitStatus holt Zähler, Datum und Grenze einzeln) —
bei jedem Öffnen des Finanzreiters und nach jedem Erfassen, weil
loadValuation() daran hängt.
```
