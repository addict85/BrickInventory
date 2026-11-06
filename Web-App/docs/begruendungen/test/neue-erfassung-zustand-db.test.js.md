# Begründungen zu `test/neue-erfassung-zustand-db.test.js`

Die ausführlichen Kommentare aus `test/neue-erfassung-zustand-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein neues Exemplar bekommt den Zustand, den das Set WIRKLICH hat.

── Der Fehler, den das verhindert ──────────────────────────────────────────
src/sets/setService.ts → priceForNewAcquisition() las

    SELECT condition FROM sets WHERE user_id=$1 AND set_number=$2

also nur den GESPEICHERTEN Wert. jobs/priceJob.ts → conditionsNeededFor()
fragt an derselben Stelle zuerst die ERFASSUNGEN und nimmt den
gespeicherten Wert nur, wenn es keine gibt. Zwei Antworten auf dieselbe
Frage.

Weicht der gespeicherte Wert von den Erfassungen ab — genau der Fall, fuer
den effectiveCondition() gebaut wurde ("etwa weil ein Set nachtraeglich auf
Neu korrigiert wurde") —, bekam das neue Exemplar den falschen Marktpreis.

NACHGEMESSEN, sets.condition='N', einzige Erfassung 'U',
Marktpreis U=20 / N=100, danach Menge von 1 auf 2:

    vorher   [{U, 10}]
    nachher  [{U, 10}, {N, 100}]   <- Neupreis fuer ein gebrauchtes Set
    jetzt    [{U, 10}, {U,  20}]

Das ist Geld, nicht nur eine Plakette: Der Kaufpreis der neuen Erfassung
geht in Bestandswert und G&V ein.

Dieselbe Verwechslung — gespeicherter Wert gegen das, was die Erfassungen
sagen — ist in diesem Baum jetzt zum achten Mal aufgetreten. Deshalb geht
sie hier durch resolveSetCondition(), die eine Stelle, an der die Regel
steht.

── Warum das ein Verhaltenstest ist ────────────────────────────────────────
Die Aussage ist "das neue Exemplar traegt den Zustand des Sets und den dazu
passenden Preis". Am Quelltext waere nur zu sehen, dass dieselbe Funktion
gerufen wird — nicht, was dabei herauskommt.
```

<a id="kein-quelltext-liest-kaufpreis-oder-zust"></a>
## `test('kein Quelltext liest Kaufpreis oder Zustand aus sets', () => {`

```text
── Warum diese Regel umgeschrieben wurde ──────────────────────────────────

Sie lautete: „Wer sets.condition liest, muss im selben Atemzug die
ERFASSUNGEN beruecksichtigen" — mit einem Selbstnachweis, der mindestens
drei Lesestellen verlangte. Nach Migration 0032 gibt es NULL, und der
Selbstnachweis haette gemeldet, dass die Suche nicht mehr greift. Er hatte
recht: Die Regel war fuer eine Spalte geschrieben, die es nicht mehr gibt.

Die Nachfolgeregel ist strenger und braucht keinen Umkreis mehr: Die beiden
Spalten DUERFEN in Abfragen auf `sets` gar nicht mehr vorkommen.

Dass sie auf einer fertig migrierten Datenbank auch wirklich fehlen, prueft
test/sets-ohne-kaufpreisspalte-db.test.js — und zwar gegen eine von null
aufgebaute Datenbank, denn nur dort ist die Aussage ueberhaupt pruefbar:
db/schema.sql legt die Spalten weiterhin an (Migration 0007 braucht sie),
und auf der gemeinsamen Test-Datenbank ruft jede Testdatei initSchema() auf.
```

<a id="verboten"></a>
## `const verboten = [`

```text
Gesucht werden die Formen, in denen die zwei Spalten in diesem Baum
tatsaechlich vorkamen — GEFUNDEN, nicht erdacht (git log von Migration
0032 nennt jede Stelle):

  s.purchase_price / s.condition      die Finanzabfragen, mit Alias s
  sets.purchase_price=                die zwei Spiegel-Anweisungen
  SELECT condition FROM sets          priceForNewAcquisition
  SELECT purchase_price, condition FROM sets   adjustAcquisitionsToQuantity
  COALESCE(condition,'N') AS c … FROM sets     der Preisjob
  INSERT INTO sets (… purchase_price …)        die drei Schreibwege
```
