# Begründungen zu `test/compose-pgweb.test.js`

Die ausführlichen Kommentare aus `test/compose-pgweb.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
pgweb ist optional, nur lokal erreichbar und startet nicht von selbst mit.

── Warum es diesen Test gibt (Nachtrag 54) ─────────────────────────────────
Wer pgweb erreicht und sich anmeldet (PGWEB_PASSWORD), hat vollen Zugriff
auf die Datenbank — alle Konten, alle Sitzungen, alle Daten — und kann sie
ändern. Der Dienst ist damit die einzige Stelle im ganzen Aufbau, an der eine
einzige geänderte Zeile in compose.yaml die komplette Installation offenlegt:
Aus `127.0.0.1:8081:8081` wird beim Kopieren schnell `8081:8081`, und dann
hängt die Datenbank je nach Router am offenen Netz.

Genau diese drei Eigenschaften hält der Test fest:
  1. Bindung an 127.0.0.1 — nur auf dem Server selbst erreichbar
  2. profiles: ["tools"] — `docker compose up -d` startet ihn NICHT mit
  3. kein Volume aus dem Projekt — pgweb braucht keinen Dateizugriff

Der Test prüft die tatsächliche YAML-Struktur, nicht den Wortlaut: Eine
Prüfung auf Zeichenketten wäre hier zu leicht auszuhebeln (ein Kommentar mit
der richtigen Zeichenfolge genügte).
```
