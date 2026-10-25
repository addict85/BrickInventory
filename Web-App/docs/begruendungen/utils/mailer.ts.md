# Begründungen zu `utils/mailer.ts`

Die ausführlichen Kommentare aus `utils/mailer.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Mailversand — SMTP, Vorlagen, Themes.

── Warum die Datei aus routes/ hierher gezogen ist (Nachtrag 176) ──────────

Sie lag als routes/mailer.ts dort, hatte aber nie eine Route: kein
express.Router(), kein req, kein res. Sie ist der Mailversand, und der ist
Werkzeug, keine Schnittstelle.

Aufgefallen ist es, als der Preisalarm sie brauchte — test/schichten.test.js
meldete „Neue Abhaengigkeit von einer Fachdatei auf eine ROUTE" und bot an,
das in die Ausnahmeliste zu schreiben. Die Liste ist leer, und sie sollte es
bleiben: Die Regel hatte recht, nur nicht ueber den Preisalarm, sondern
ueber den Ablageort dieser Datei.

Fuer die beiden bisherigen Nutzer (routes/auth.ts, routes/settings.ts)
aendert sich nur der Importpfad.
```

<a id="gettransporter"></a>
## `getTransporter`

```text
Verbindung zum Mailserver.

── Zertifikatsprüfung ──────────────────────────────────────────────────────
Hier stand fest verdrahtet `rejectUnauthorized: false` — die einzige Stelle
im ganzen Projekt, die eine TLS-Prüfung abschaltete. Damit ging die
SMTP-Anmeldung (Benutzer und Passwort) und jeder Link zum
Passwort-Zurücksetzen über eine Verbindung, deren Gegenstelle nicht
überprüft wurde: Wer sich dazwischenhängt, bekommt beides.

Für ein selbst signiertes Zertifikat im Heimnetz ist das Abschalten
nachvollziehbar — deshalb bleibt es möglich, aber als bewusste Entscheidung
unter `smtp_insecure_tls` (Einstellungen → E-Mail). Vorgabe ist jetzt
PRÜFEN; wer nichts einstellt, ist geschützt.
```

<a id="mailtheme"></a>
## `MailTheme`

```text
Farbpalette je Design.

E-Mails kennen keine CSS-Variablen und kein externes Stylesheet — jeder Wert
muss direkt im Markup stehen. Die Paletten sind daher aus themes/*.css bzw.
styles.css abgeleitet und hier gespiegelt.

Das Design ist eine GLOBALE Einstellung (`app_theme` in global_settings),
nicht pro Nutzer — der Mailer liest sie beim Versand.
```

<a id="infobox"></a>
## `infoBox`

```text
Hinweiskasten in der Mail.

── Der Parameter war da und wurde ignoriert ────────────────────────────────
`theme` stand seit jeher in der Signatur, aber die Farben waren fest
verdrahtet (#eff6ff/#bfdbfe/#1e40af — das Blau des klassischen Designs). Im
Stein-Design blieb der Kasten deshalb blau, waehrend Kopf, Knopf und
Hintergrund umschalteten.

Gefunden von noUnusedParameters: Ein Parameter, den niemand liest, ist
entweder ueberfluessig — oder er sollte benutzt werden und wurde vergessen.
Hier das Zweite; mail-theme.test.js prueft seit jeher, dass die Funktion ihn
ENTGEGENNIMMT, und genau das war zu wenig.

`border` und `text` kommen aus dem Design, der Hintergrund bleibt eine helle
Tonung: `surface` waere weiss und der Kasten damit unsichtbar.
```

<a id="sendpasswordresetmail"></a>
## `sendPasswordResetMail`

```text
── Passwort-Reset-Mail ───────────────────────────────────────────────────────

── Marcos Frage vom 25.09. ─────────────────────────────────────────────────

  „Werden alle E-Mails in der eingestellten Sprache des Benutzers
   versendet?"

Bis hierher: nein. Diese Mail war die einzige, die gar keine Sprache kannte
— sie ging IMMER auf Deutsch hinaus, auch an ein Konto, das die Oberflaeche
auf Englisch fuehrt. Die Bestaetigungsmail konnte es laengst (`lang`), die
Alarmmail liest die Sprache aus den Benutzereinstellungen; hier fehlte der
Parameter schlicht.

Vorgabe 'de' und nicht 'en': Sie ist die Sprache dieses Baums, und ein
Aufrufer, der nichts weiss, soll sich nicht fuer den Empfaenger entscheiden.
```

<a id="alarmmaildaten"></a>
## `AlarmMailDaten`

```text
── Preisalarm-Mail ───────────────────────────────────────────────────────────

── Marcos Vorgabe vom 25.09. ───────────────────────────────────────────────

  „Kannst du die Mail noch etwas schoener gestalten analog der E-Mail
   Bestaetigen Mail?"

Sie war reiner Text — als einzige. Die Bestaetigungs- und die Reset-Mail
laufen seit jeher durch emailTemplate() und tragen das eingestellte Design;
die Alarmmail entstand im Preislauf und hat diesen Weg nie genommen.

── Warum sie hier steht und nicht in utils/preisalarm.ts ───────────────────

Dort steht das WANN — die Hysterese, der Merker, der Uebergang. Hier steht
das WIE. Genau diese Trennung nennt pruefeSet() schon in seinem Kommentar
(„Getrennt, damit pruefeSet() ueber das WANN entscheidet, nicht ueber das
WIE"); die Gestaltung gehoert zu den anderen Vorlagen und nicht neben die
Regel.

── Warum sie die Mail BAUT und nicht verschickt ────────────────────────────

preisalarm.ts bekommt seinen Versender als Parameter (Versender-Typ, siehe
die Begruendung dort: ein Import im Rumpf liess sich im Test nicht
ersetzen). Wuerde hier verschickt, waere genau diese Naht wieder zu.
```

<a id="bauealarmmail"></a>
## `baueAlarmMail`

```text
Einmal sagen, warum der Knopf fehlt.

── Marcos Befund vom 25.09. ───────────────────────────────────────────────

  „In der Email vom Preisalarm finde ich den direkten Link nicht."

Er hatte recht, und der Grund war genau dieser Zweig: Ohne APP_BASE_URL
laesst die Mail den Knopf weg — mit gutem Grund (ein geratener Host in einer
Mail ist schlechter als kein Knopf), aber WORTLOS. Aus Sicht des Empfaengers
war das Merkmal einfach nicht da, und aus Sicht des Betreibers gab es nichts
nachzusehen.

Genau dieselbe Luecke hat getBaseUrl() in routes/auth.ts schon geschlossen,
mit demselben Mittel und derselben Begruendung: „ein einmaliger Log-Hinweis
in Produktion macht auf die Luecke aufmerksam." Hier fehlte er.

Einmal je Prozess: Der Preislauf baut die Mail fuer JEDEN gerissenen Alarm.
Bei zwanzig Alarmen stuende die Zeile sonst zwanzigmal im Protokoll und
saehe aus wie ein Sturm statt wie ein Hinweis.
Der Merker selbst steht seit der QR-Code-Aenderung in utils/basisUrl.ts:
Dieselbe Buchhaltung wurde an drei Stellen gebraucht, je Bereich getrennt.
```

<a id="bauealarmmail-zahlen"></a>
## `zahlen`

```text
Die beiden Zahlen gross und nebeneinander: Marktpreis und Schwelle sind
die einzige Frage, die diese Mail beantwortet. Eine Tabelle statt flex,
weil Outlook kein flex kennt — dieselbe Bauweise wie emailBtn() und
infoBox() darueber.

── Warum 44/12/44 und nicht 50/12px/50 (Marcos Befund vom 25.09.) ──────

  „Kannst du die Kacheln Marktpreis und Deine Schwelle etwas kleiner
   machen (weniger Breit) damit es in der Mitte eine Lücke hat?"

Der Abstand WAR schon da — als 12px breite Zelle. Nur ergaben zwei Zellen
zu je 50 % plus 12 Pixel mehr als die Tabelle breit ist, und was dann
geschieht, entscheidet der Mailklient: Er staucht irgendetwas. Bei Marco
war es der Abstand, und die Kacheln stiessen aneinander.

Jetzt geht die Rechnung auf: 44 + 12 + 44 = 100. Der Abstand ist damit
nicht mehr das, was uebrig bleibt, sondern ein gesetzter Wert — und die
Kacheln sind genau um ihn schmaler. Die Breiten stehen doppelt (Attribut
UND style), weil Outlook das Attribut liest und moderne Klienten das style.
```
