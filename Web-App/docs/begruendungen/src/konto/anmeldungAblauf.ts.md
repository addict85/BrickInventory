# Begründungen zu `src/konto/anmeldungAblauf.ts`

Die ausführlichen Kommentare zu `src/konto/anmeldungAblauf.ts`, wörtlich aus der früheren Stelle
übernommen. Im Code steht je Stelle der erste Absatz und ein Verweis hierher. Neue
Geschichte gehört in die Commit-Nachricht (siehe CLAUDE.md).

<a id="put-profile-emailsent"></a>
## `emailSent`

```text
Send verification mail to new email

── Die Sprache des KONTOS, nicht die Vorgabe ───────────────────────

Marcos Frage vom 25.09.: „Werden alle E-Mails in der eingestellten
Sprache des Benutzers versendet?" Hier war die Antwort nein — der
Aufruf liess `lang` weg und fiel damit auf 'de' zurueck, waehrend
derselbe Versand bei der REGISTRIERUNG die Sprache laengst mitgibt.
Ein englischsprachiges Konto, das seine Adresse aendert, bekam eine
deutsche Mail.
```

<a id="post-qr-token-basis"></a>
## `basis`

```text
── Ohne Adresse kein Code ──────────────────────────────────────

Marcos Frage vom 25.09.: „Kannst du das location.origin nicht komplett
entfernen?" — Ja, und dann muss der Server die Adresse liefern oder den
Code verweigern. Ein drittes gibt es nicht.

Verweigern und nicht raten: Der QR-Code ist der einzige Ort im Baum, an
dem eine falsche Adresse SPAETER auffaellt und nicht sofort. Er laesst
sich scannen, die App verbindet sich im WLAN — und findet den Server
unterwegs nie wieder. Ein Fehler, der im Wohnzimmer entsteht und sich im
Zug zeigt. Eine klare Absage mit Begruendung ist dagegen in dem Moment
sichtbar, in dem sie entsteht.

Und sie steht VOR jedem Datenbankzugriff: Weiter unten entstuende sonst
eine Nonce, die fuenf Minuten lang ein Konto oeffnet und die niemand je
einloest — ein Zugangscode auf Vorrat, fuer nichts.
```

<a id="post-qr-token-tage"></a>
## `tage`

```text
── Wie lange soll der ZUGANG gelten, den dieser Code eroeffnet? ──────

Marcos Wunsch, pro QR-Code waehlbar. Die Wahl wird HIER getroffen — von
der angemeldeten Sitzung — und wandert mit der Nonce in die Tabelle.
Nicht in POST /qr-login: Der ist unangemeldet erreichbar, und wer einen
Code abfotografiert, duerfte sich sonst selbst die laengste Laufzeit
aussuchen. Die ganze Ueberlegung steht in
db/migrations/0016-token-laufzeit.sql.

Ein unbekannter Wert wird nicht abgewiesen, sondern zu „keine feste
Frist" — dann gilt wie bisher allein die Gleitfrist. Ein aelterer
Client, der das Feld gar nicht kennt, verhaelt sich damit unveraendert.
```
