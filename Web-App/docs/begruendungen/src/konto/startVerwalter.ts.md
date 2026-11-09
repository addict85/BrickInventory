# Begründungen zu `src/konto/startVerwalter.ts`

Die ausführlichen Kommentare zu `src/konto/startVerwalter.ts`, wörtlich aus der früheren Stelle
übernommen. Im Code steht je Stelle der erste Absatz und ein Verweis hierher. Neue
Geschichte gehört in die Commit-Nachricht (siehe CLAUDE.md).

<a id="frueherzurlaufzeitangelegt"></a>
## Abschnitt

```text
Default admin user

VORHER: Immer 'admin' / 'admin'. Das ist kein Startwert, den man später
ändert, sondern ein öffentlich bekanntes Credential — jede erreichbare
Installation, deren Betreiber den Login-Screen nicht sofort besucht, ist
damit sofort übernehmbar (Shodan-Scans nach genau diesem Muster sind
Alltag). Jetzt: ADMIN_PASSWORD aus der Umgebung, falls gesetzt (für
automatisierte Deployments); sonst ein zufälliges Passwort, das NUR beim
allerersten Start in die Logs geschrieben wird und dessen Konto als
"muss geändert werden" markiert ist (must_change_password s.o.).
```
