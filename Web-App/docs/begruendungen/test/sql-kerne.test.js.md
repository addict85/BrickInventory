# Begründungen zu `test/sql-kerne.test.js`

Die ausführlichen Kommentare aus `test/sql-kerne.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Keine SQL-Anweisung steht in mehr als einer Datei.

── Warum diese Regel ───────────────────────────────────────────────────────
Der rote Faden dieser ganzen Arbeit: Was zweimal dasteht, laeuft irgendwann
auseinander. Diese Prueflung ist die Messung, mit der die Fundstellen
gefunden wurden — jetzt als Regel, damit die naechste Abschrift beim
Entstehen auffaellt statt beim Suchen.

Sie hat in dieser Fassung 16 Kerne gemeldet. Vier davon trugen einen echten,
gemessenen Fehler:

  price_cache/price_history  Der Nachtjob schrieb die Null-Zeile nicht und
                             kostete dauerhaft zwei BrickLink-Abrufe je Set.
  rb_inventories             Vier Kandidatenregeln, zwei davon fanden eine
                             blank abgelegte Zeile nicht.
  catalog_cache              Zwei Schluessel fuer dieselbe Markierung — drei
                             Abrufe fuer ein Set ohne Preis.
  Zustand eines Sets         Ein neues Exemplar bekam den Neupreis fuer ein
                             gebrauchtes Set, weil der Zustand an zwei Orten
                             stand. Seit Migration 0032 gibt es nur einen
                             (set_acquisitions).

Bei zwei weiteren wurde AUSDRUECKLICH kein Unterschied gemessen
(shared_instructions, der Loeschweg fuer manuelle Stuecke). Die sind
trotzdem zusammengelegt: nicht wegen eines Fehlers, sondern damit die
naechste Aenderung an einer Stelle stattfindet.

── Was sie NICHT prueft ────────────────────────────────────────────────────
Nur wortgleiche Anweisungen ueber Dateigrenzen. Dieselbe Frage in zwei
verschiedenen Formulierungen findet sie nicht — genau daran ist meine
Setnummer-Regel einmal vorbeigelaufen (siehe
test/setnummer-schreibweise-db.test.js). Sie ist ein Netz, kein Beweis.
```
