# Begründungen zu `public/js/01-konto.js`

Die ausführlichen Kommentare aus `public/js/01-konto.js` (bis zur Teilung in `public/js/01-core.js`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="applytheme"></a>
## `applyTheme`

```text
── DESIGN, VORGABEN, NAMENSZUG ──────────────────────────────────────────
Setzt das globale App-Design (vom Admin gewählt) als data-theme auf <html>.
Das CSS bringt für [data-theme="brick"] das blaue Stein-Design mit.

Die eigentliche Anwendung liegt in js/00-theme-boot.js, das schon im <head>
läuft — sonst hätte der Login-Screen das Design erst nach dem Einloggen.
Hier wird nur noch durchgereicht, damit der localStorage-Cache mitgeführt
wird und ein Design-Wechsel des Admins beim nächsten Laden sofort greift.
```

<a id="keine-eigene-liste-gueltiger-designs"></a>
## `if`

```text
── Keine zweite Liste hier ────────────────────────────────

Hier stand `if (theme !== 'brick' && theme !== 'classic') return null;` —
eine EIGENE Liste der gueltigen Designs, geschrieben, als es zwei gab.
Inzwischen sind es sechs. Die vier neueren wurden hier abgewiesen und
NIE angewendet: Der Wechsel wirkte erst beim naechsten Seitenaufruf,
wenn js/00-theme-boot.js den Serverwert aus dem <html>-Attribut liest.

Marco: „Teilweise (nicht bei allen Designs) muss beim Aendern die Seite
neu geladen werden." Genau die zwei aus der alten Liste schalteten
sofort um, die vier danach nicht.

Dieselbe Bauart wie der fehlende <link> eine Runde vorher: eine
handgepflegte Aufzaehlung von Designs, die beim Hinzufuegen des
naechsten nicht mitwaechst. Die Pruefung dazu steht in theme.test.js.

Die gueltigen Werte kennt ausschliesslich js/00-theme-boot.js. Ohne
dieses Skript wird NICHTS gesetzt — lieber kein Design als ein
ungeprueftes Attribut.
```

<a id="zeigebenutzernamen"></a>
## `zeigeBenutzernamen`

```text
Den Namenszug in der Kopfleiste schreiben — mit dem Verwalter-Zusatz.

── Marcos Vorgabe vom 17.10. ───────────────────────────────────────────────

„Kannst du das \"Admin\" nicht als eigene Kachel anzeigen sondern in ()
hinter dem Benuzter? Also z.b. marco.bigolin (Admin) oder marco.bigolin
sofern der User kein Admin ist."

Die eigene Plakette (`#abadge`) ist damit aus der Kopfleiste verschwunden.
Sie war ein zweites Element, das dasselbe sagte wie der Name daneben — und
sie stand zwischen dem Namensknopf und dem rechten Rand, weshalb das Menü
nicht ganz rechts sass.

── Warum als EINE Funktion und nicht zweimal hingeschrieben ────────────────

Geschrieben wird der Name an ZWEI Stellen: hier beim Anmelden und in
js/05-settings.js nach dem Ändern des Profils. Genau dort stand die Zeile
schon einmal falsch („uname" statt „ubadge") und lief ins Leere, ohne dass
es jemand merkte. Zwei Fassungen derselben Regel laufen auseinander; diese
hier ist die einzige.

Der Zusatz kommt aus dem Sprachtext (`users.admin_badge`) und nicht als
Literal: Er stand schon übersetzt in der Plakette, und eine englische
Oberfläche soll nicht plötzlich „Admin" auf Deutsch zeigen.
```
