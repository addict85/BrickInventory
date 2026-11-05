# Begründungen zu `test/portfolio-additions-db.test.js`

Die ausführlichen Kommentare aus `test/portfolio-additions-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Neu erfasste Sets verändern die Prozentzahl der Portfolio-Kurve NICHT.

── Marcos Befund ───────────────────────────────────────────────────────────
„Die Berechnung scheint nicht korrekt zu sein. Neu hinzugefügte Sets sollen
nicht dazu führen, dass sich der %-Wert ändert. Die +850.2% sind
offensichtlich nicht korrekt."

Auf seinem Bild: 26 Sets, davon 24 am selben Tag erfasst, Kopfzeile +850,2 %
— und direkt darunter die Kachel „Gesamt G&V" mit −2,8 %. Zwei Zahlen über
dieselbe Sammlung, die einander widersprechen.

Ursache: Die Kurve zeigte „Wert dessen, was zu diesem Zeitpunkt erfasst
WAR". Ein Set trat an dem Tag in die Summe ein, an dem sein Preisverlauf
begann. Die Prozentzahl vergleicht den ersten Punkt mit dem letzten und
meldete damit den Zuwachs der SAMMLUNG als Wertentwicklung.

Nachgestellt (2 Sets seit einer Woche, 24 gestern dazu, Preise leicht
FALLEND): vorher +264,24 %, jetzt −0,18 %.

── Was der Test festhält ───────────────────────────────────────────────────
Die Aussage, nicht die Umsetzung: Die Prozentzahl ist der gewichtete
Mittelwert der PREISBEWEGUNGEN im Bestand. Zukäufe können sie nicht erhöhen
und das Vorzeichen nicht drehen; sie können sie nur Richtung null ziehen,
weil ein eben erfasstes Set sich noch nicht bewegt hat.

── Was NICHT behauptet wird ────────────────────────────────────────────────
Dass die Zahl bei einem Zukauf exakt stehen bleibt. Gemessen: zwei Sets mit
+10 % ergeben +10 %; kommen 24 unbewegte dazu, sind es +1,43 %. Das ist
Verwässerung, kein Fehler — die 24 gehören ab jetzt zum Bestand und haben
sich nicht bewegt. Wer stattdessen die HISTORISCHE Rendite unverändert lassen
will, braucht eine verkettete Tagesrendite über die jeweils an beiden Tagen
gehaltenen Sets; das ist eine andere Kennzahl und wäre eine eigene
Entscheidung.
```

<a id="for-stelle"></a>
## `for (let i = 3; i <= 26; i++) await setMit(i, 1, 50, 50);`

```text
── Der Fall aus Marcos Bild: heute 24 Sets dazu ────────────────────────
Ihr Preis bewegt sich NICHT (gestern wie heute 50), die Sammlung wird
aber siebenmal so wertvoll.

Die Prüfung lautet: Die Prozentzahl ist der GEWICHTETE MITTELWERT der
Preisbewegungen im Bestand. Sie kann durch Zukäufe nicht STEIGEN und
nicht das Vorzeichen wechseln; unbewegte Sets ziehen sie höchstens
Richtung null. Vorher war sie +264 % — ein Wert, den kein einzelnes Set
hergab, weil sie den Zuwachs der Sammlung mitmass.
```
