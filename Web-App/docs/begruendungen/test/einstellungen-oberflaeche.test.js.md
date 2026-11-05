# Begründungen zu `test/einstellungen-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/einstellungen-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Einstellungen: einheitliche Speichern-Knöpfe und benannte Aktionen der
Benutzertabelle — am echten Bündel in jsdom nach dem Übersetzen.

  - Jeder Speichern-Knopf der Einstellungen heisst „Speichern“ und trägt
    das Speichern-Symbol (vorher: mal ohne Symbol, mal mit Schlüssel, einmal
    „SMTP speichern“).
  - Jede Aktion der Benutzertabelle hat ein sichtbares Wort, einen Tooltip
    und einen Namen mit dem Konto.
  - API-Schlüssel und Geheimnisse sind Passwortfelder mit einem Knopf
    „Anzeigen“ (aria-pressed); die Leiste wechselt zwischen den Abschnitten,
    von denen je einer dasteht.
  - „Zum Benutzer“ bei einem Admin schickt is_admin:false. Vorher kam
    data-arg2="true" an, toggleAdmin() kannte nur '1' und machte jeden
    Admin erneut zum Admin.
```
