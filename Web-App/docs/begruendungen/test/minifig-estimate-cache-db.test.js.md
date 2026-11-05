# Begründungen zu `test/minifig-estimate-cache-db.test.js`

Die ausführlichen Kommentare aus `test/minifig-estimate-cache-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der geschätzte Minifiguren-Marktpreis wird zwischengespeichert.

── Marcos Auftrag (Nachtrag 144) ───────────────────────────────────────────
„Der geschätzte Marktpreis einer Minifigur soll ebenfalls im Cache
gespeichert werden, damit er nicht jedes Mal neu geholt werden muss. Weiter
soll er auch sonst gespeichert werden, damit der Preisverlauf angezeigt
werden kann."

── Was fehlte ──────────────────────────────────────────────────────────────
GESCHRIEBEN wurde er längst — in minifig_price_cache UND
minifig_price_history. GELESEN nie.

Jeder Aufruf holte deshalb erneut die Teile-Zusammensetzung von Rebrickable
und danach den BrickLink-Preis JE TEIL. Eine Minifigur mit fünfzehn Teilen
kostete fünfzehn Preisabfragen — bei jedem Öffnen der Finanzseite, für jede
Figur ohne BrickLink-Nummer.

── Zur Frist ───────────────────────────────────────────────────────────────
Dieselbe wie beim echten Abruf (`price_cache_ttl`, Vorgabe 24 h). Der Wert ist
derselbe Marktpreis, nur anders ermittelt — er soll nicht länger gelten als
ein von BrickLink geholter.

Dass innerhalb der Frist KEIN neuer Verlaufspunkt entsteht, ist richtig und
kein Verlust: Ein zweiter Punkt mit demselben Wert am selben Tag trägt nichts
bei. Nach Ablauf wird neu gerechnet und geschrieben.
```
