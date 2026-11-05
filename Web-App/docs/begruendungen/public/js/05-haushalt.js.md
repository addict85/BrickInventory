# Begründungen zu `public/js/05-haushalt.js`

Die ausführlichen Kommentare aus `public/js/05-haushalt.js` (bis zur Teilung in `public/js/05-settings.js`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="loadhousehold"></a>
## `loadHousehold`

```text
Ablauf: Das Hauptkonto erzeugt einen Einladungscode, das andere Konto gibt
ihn hier ein. Zustimmen muss zwingend BEIDE Seiten — der eine durch
Erzeugen, der andere durch Einlösen.

Die Karte zeigt je nach Rolle nur EINEN der beiden Kästen. Wer schon
Unterkonto ist, sieht keinen Einladungsknopf (Konten lassen sich nur über
eine Stufe verknüpfen), und wer Unterkonten hat, sieht kein Eingabefeld.
Beides würde der Server ohnehin ablehnen — aber ein Knopf, der immer eine
Fehlermeldung erzeugt, ist schlimmer als keiner.
```
