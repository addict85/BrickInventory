# Begründungen zu `utils/financeCalc.ts`

Die ausführlichen Kommentare aus `utils/financeCalc.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Der Finanzteil — eine Tuer fuer alle Aufrufstellen.

── Warum die Datei nur noch weiterreicht (Nachtrag 171) ────────────────────

Sie trug 1529 Zeilen und drei Aufgaben zugleich: Preisbeschaffung,
Bewertung und Gewinnrechnung. Wer am Anfragekontingent etwas aenderte,
arbeitete in derselben Datei wie die Gewinnrechnung.

Jetzt liegen sie unter utils/finance/ in der Reihenfolge, in der sie
aufeinander stehen — die Schichtung hat `tsc` beim Trennen aufgedeckt, nicht
ich (siehe den Kopf von preise.ts). Sechzehn Aufrufstellen zeigen weiterhin
hierher; keine einzige musste angefasst werden. Genau dafuer ist diese Datei
geblieben.
```
