# Begründungen zu `utils/validate.ts`

Die ausführlichen Kommentare aus `utils/validate.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="item-number-re"></a>
## `ITEM_NUMBER_RE`

```text
Eingangsvalidierung für frei erfassbare Katalogfelder.

Vorher gab es KEINE: addManualPart()/addManualMinifig() haben part_number,
part_name, color_name, category_name und vor allem image_url genau so
übernommen, wie sie ankamen — beliebige Länge, beliebige Zeichen, beliebiges
URL-Schema. Zusammen mit den innerHTML-Templates im Frontend war das der
Einstiegspunkt für Stored XSS (`image_url` mit einem " brach aus dem
src-Attribut aus, `javascript:` als Schema wurde ungeprüft durchgereicht).

Das Escaping im Frontend ist die eine Hälfte der Lösung; dass gar nicht erst
Unsinn in der DB landet, die andere. Beide sind nötig — Escaping schützt die
Webapp, die Validierung zusätzlich jeden anderen Konsumenten der API.
```

<a id="acquisitionquantity"></a>
## `acquisitionQuantity`

```text
Menge einer Erfassung: 1 bis 10 000.

`positiveInt` deckelt bei einer Million — für eine Sammlung ist das keine
Grenze, sondern eine Zahl. Am laufenden Server kam über die API
`quantity: 999999999` durch und stand danach als 999 999 995 in `sets`; jede
Wertangabe daraus ist Unsinn, und die Kachel zeigt sie an.

10 000 ist grosszügig gewählt: Wer mehr als zehntausend Exemplare DESSELBEN
Sets besitzt, hat kein Erfassungsproblem, sondern ein Lager.
```

<a id="optionalprice"></a>
## `optionalPrice`

```text
Kaufpreis oder Stückpreis: nicht negativ, in plausiblem Rahmen.

Negative Beträge gingen an ALLEN drei Erfassen-Wegen durch (Set, manuelles
Teil, manuelle Minifigur) und wanderten unverändert in die Summen des
Finanzreiters — ein Tippfehler mit Minuszeichen senkte damit stillschweigend
den Gesamtwert der Sammlung.

Die Weboberfläche verhindert das mit `min="0"`. Die Regel gehört aber auf den
Server: Die App und jeder API-Aufruf gehen an der Oberfläche vorbei.

@returns null bei leerer Angabe (= „kein Preis"), sonst der geprüfte Betrag
```

<a id="strictbool"></a>
## `strictBool`

```text
Einen Wahrheitswert aus einer Anfrage lesen — streng.

── Warum nicht einfach `wert ? 1 : 0` ──────────────────────────────────────
Genau das stand an beiden Rollen-Endpunkten (PUT /api/v1/auth/users/:id/admin
und PUT /api/v1/admin/users/:id/role). In JavaScript ist die ZEICHENKETTE
"false" wahr. Am laufenden Endpunkt nachgestellt:

  {"is_admin": false}     → HTTP 200, Rechte entzogen      ✓
  {"is_admin": "false"}   → HTTP 200, Rechte NICHT entzogen ⚠
  {"is_admin": "0"}       → HTTP 200, Rechte NICHT entzogen ⚠

Der Admin bekommt „erfolgreich" gemeldet und glaubt, die Rechte entzogen zu
haben — sie bestehen weiter. Zusätzlich lief der Selbstschutz („eigene
Admin-Rolle kann nicht entfernt werden") ins Leere, weil auch er den Wert
nur auf Wahrheitsgehalt prüfte. Ein Formular mit application/x-www-form-
urlencoded oder ein Client, der Wahrheitswerte als Text schickt, trifft das
sofort.

Lieber laut scheitern als still das Gegenteil tun: Was nicht eindeutig als
wahr oder falsch lesbar ist, wird abgewiesen.
```

<a id="istersatzteil"></a>
## `istErsatzteil`

```text
Ist dieser Wert ein ERSATZTEIL-Kennzeichen, das „ja" bedeutet?

── Warum das nötig wurde ───────────────────────────────────────────────────
NACHGEMESSEN: `is_spare` wurde an SECHS Stellen gedeutet, mit vier
verschiedenen Vorstellungen davon, was „ja" heisst:

  utils/handlers/parts.ts    true, 1, 't', 'true'
  routes/api_v1/sets.ts      true, 1, 't', 'true', 'True'   ← eine mehr
  routes/api_v1/sets.ts      r.is_spare ? 't' : 'f'         ← dritte Form
  routes/api_v1/sets.ts      nicht-Ersatzteil: 'f','false','False','0',''
  routes/api_v1/minifigs.ts  nur 't'
  Android, Part.isSpareFlag  '1', 'true', 't'               ← ohne 'True'

Die Spalte ist INTEGER, der Treiber liefert Aggregate als Zeichenkette, und
der Rebrickable-Katalog schreibt 't'/'f'. Genau deshalb hat nie jemand die
Ersatzteil-Plakette gezeichnet, obwohl der Text dafür in beiden Sprachen
bereitliegt: Man konnte nicht sagen, was das Feld bedeutet.

Und die naheliegende Abkürzung wäre falsch gewesen: Der Server liefert
`"0"` als ZEICHENKETTE, und die ist in JavaScript WAHR. Ein `if (p.is_spare)`
im Frontend hätte JEDES Teil als Ersatzteil markiert.

Deshalb hier, an einer Stelle, grosszügig im Lesen — und die Antworten
tragen danach einen echten Wahrheitswert, sodass die Clients gar nichts
mehr deuten müssen.

Bewusst KEIN strictBool(): Das ist für Eingaben aus Anfragen gedacht und
wirft bei Unlesbarem. Hier kommen Werte aus der eigenen Datenbank und aus
Fremdkatalogen; ein unbekannter Wert heisst „kein Ersatzteil", nicht
„Abbruch der Teileliste".
```

<a id="ersatzteilsql"></a>
## `ersatzteilSql`

```text
Dieselbe Lesart wie [istErsatzteil], aber als SQL-Ausdruck.

Drei Abfragen entscheiden schon in der Datenbank, ob eine Zeile ein
Ersatzteil ist — dort kann keine TypeScript-Funktion laufen. Ohne diesen
Helfer stuende die Aufzaehlung ein zweites Mal im Baum, in SQL, und genau
so ist sie ueberhaupt erst auseinandergelaufen (eine Stelle kannte nur 't').

@param spalte Spaltenname, bereits vertrauenswuerdig — es ist NIE ein Wert
              aus einer Anfrage, sondern immer ein im Code stehender Name.
```

<a id="einzelwert"></a>
## `einzelwert`

```text
Einen Routen- oder Abfrageparameter als EINEN Text nehmen.

── Warum es das braucht (Nachtrag 132) ─────────────────────────────────────

`@types/express@5` typisiert `req.params[x]` als `string | string[]`, und die
Abfrageparameter sind es ohnehin: `?accounts=a&accounts=b` liefert zur
Laufzeit ein Array. Wer das ungeprüft weiterreicht, bekommt an einer ganz
anderen Stelle ein `["a","b"]`, wo eine Setnummer erwartet wird.

Aufgefallen ist es erst, als die späten `require()` zu echten `import`
wurden: Solange die Zielfunktion über `require()` kam, war sie `any` — und
`any` prüft keine Typen. Drei Aufrufstellen meldete tsc sofort.

Bei mehreren Werten gewinnt der ERSTE. Das entspricht dem, was die Anwendung
bisher faktisch tat, wenn nur ein Wert ankam, und ist die harmlosere Wahl:
Ein zusammengefügter Wert („a,b") wäre eine Setnummer, die es nicht gibt.
```

<a id="austabelle"></a>
## `ausTabelle`

```text
Einen Wert aus einer Nachschlagetabelle holen, wenn der Schlüssel von aussen
kommt.

── Warum es diese Funktion braucht (Nachtrag 155) ──────────────────────────
`TABELLE[schluessel]` liefert in JavaScript auch GEERBTE Eigenschaften, und
die sind wahrheitswertig. Die übliche Absicherung `TABELLE[k] || VORGABE`
greift deshalb nicht:

    const SORTS = { year_desc: 'rb.year DESC', … };
    SORTS['unbekannt']   -> undefined                -> Vorgabe greift
    SORTS['constructor'] -> function Object() { … }  -> Vorgabe greift NICHT
    SORTS['__proto__']   -> [object Object]          -> Vorgabe greift NICHT

Gefunden an drei Stellen, zwei davon tragend:

  routes/api_v1/catalog.ts   Das Ergebnis ging direkt in ein ORDER BY. Kein
                             freies Einschleusen — den eingesetzten Text kann
                             der Aufrufer nicht wählen —, aber ein von aussen
                             auslösbarer 500er. Und es WÜRDE zum Einschleusen,
                             sobald irgendwo eine Prototype-Pollution dazukäme.
  routes/sets.ts             Der Datei-Filter beim Anleitungs-Upload. Mit
                             Content-Type: constructor kam beliebiger Inhalt
                             an der Zusage "nur PDF, JPG oder PNG" vorbei.
  utils/handlers/sets.ts     Dasselbe Muster in der Set-Sortierung.

`hasOwnProperty.call` statt `Object.hasOwn`: gleichwertig, aber unabhängig
von der lib-Einstellung in tsconfig.

@param tabelle    Die erlaubten Werte. Nur EIGENE Schlüssel zählen.
@param schluessel Der Schlüssel von aussen — beliebiger Typ, wird zu String.
@param vorgabe    Was zurückkommt, wenn der Schlüssel nicht in der Tabelle steht.
@returns Der Tabellenwert, sonst `vorgabe`.
```
