# Begründungen zu `test/sperre-beim-verschieben-db.test.js`

Die ausführlichen Kommentare aus `test/sperre-beim-verschieben-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Verschiebung eines Sets serialisiert über das QUELLKONTO — geprüft über
die echte Route, nicht am Quelltext.

Kein Wettlauf: Eine EIGENE Verbindung nimmt die Sperre mit derselben
Anweisung wie db/txLock.ts und hält sie. Dann läuft die Route, und in
`pg_locks` wird nachgesehen, ob ein Warter (granted = f) steht. Nimmt die
Route die Sperre, bleibt sie stehen; nimmt sie sie nicht, wird sie fertig,
während der Halter noch hält. Die beiden Fälle schliessen einander aus.

`pg_advisory_xact_lock(a, b)` ist die zweiteilige Fassung (objsubid = 2);
`objid` ist vom Typ oid, deshalb `hashtext($2)::oid` im Prädikat.

Drei Fälle, weil die Zusicherung `(fromId, sn)` beide Teile meint:
  A. Sperre auf (Quellkonto, Set)         → die Verschiebung wartet
  B. Sperre auf (Quellkonto, ANDERES Set) → sie wartet NICHT
  C. Sperre auf (ZIELkonto, Set)          → sie wartet NICHT
```

<a id="befundwarter"></a>
## `async function befundWarter(userId, scopeKey, istFertig, grenzeMs = 50`

```text
Wartet, bis auf genau diesem Schlüssel ein Warter steht — oder bis die
Route fertig ist.

Der Rückgabewert ist der BEFUND, nicht ein Erfolg: 'wartet', 'fertig'
(die Route lief durch, obwohl die Sperre gehalten wurde — also keine
Sperre) oder 'nichts' (sie blockiert, aber nicht auf diesem Schlüssel).
Alle drei sind aussagekräftig, deshalb wirft diese Funktion nicht selbst.
```

<a id="acq-stelle"></a>
## `const acq = await erfassungsIds(HAUPT, SN_C);`

```text
Das ist der eigentliche Inhalt von `fromId`: Serialisiert wird über das
Konto, aus dem etwas WEGgeht — dort wird gelesen, gerechnet und
gelöscht. GEMESSEN: Steht `toId` in der Route, werden A UND dieser Fall
rot. Und allein fängt dieser Fall eine Sperre auf BEIDEN Konten: auch
GEMESSEN (Gegenprobe e) — A und B bleiben dabei grün, weil (fromId, sn)
ja mitgenommen wird, und nur dieser Fall wird rot.
```
