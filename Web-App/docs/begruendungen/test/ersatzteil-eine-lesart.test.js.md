# Begründungen zu `test/ersatzteil-eine-lesart.test.js`

Die ausführlichen Kommentare aus `test/ersatzteil-eine-lesart.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Was ein Ersatzteil ist, entscheidet EINE Stelle.

── Der Befund ──────────────────────────────────────────────────────────────
`is_spare` wurde an sechs Stellen gedeutet, mit vier verschiedenen
Vorstellungen davon, was „ja" heisst:

  src/teile/abfragen.ts    true, 1, 't', 'true'
  routes/api_v1/sets.ts      true, 1, 't', 'true', 'True'   ← eine mehr
  routes/api_v1/sets.ts      r.is_spare ? 't' : 'f'         ← dritte Form
  routes/api_v1/sets.ts      Filter: 'f','false','False','0',''
  routes/api_v1/minifigs.ts  nur 't'
  Android, Part.isSpareFlag  '1','true','t'                 ← ohne 'True'

Die Spalte ist INTEGER, der Treiber liefert Aggregate als Zeichenkette, und
der Rebrickable-Katalog schreibt 't'/'f'. Genau deshalb hat nie jemand die
Ersatzteil-Plakette gezeichnet, obwohl der Text dafür in beiden Sprachen
bereitlag: Man konnte nicht sagen, was das Feld bedeutet.

Und die naheliegende Abkürzung wäre falsch gewesen: Der Server lieferte
`"0"` als ZEICHENKETTE, und die ist in JavaScript WAHR — ein
`if (p.is_spare)` hätte JEDES Teil als Ersatzteil markiert.

── Was geprüft wird ────────────────────────────────────────────────────────
1. Kein Modul ausser src/infra/validate.ts zählt die Schreibweisen selbst auf.
2. Die Antworten tragen einen echten Wahrheitswert (gegen die Datenbank
   gemessen, nicht aus dem Quelltext gelesen).
```

<a id="verdaechtig"></a>
## `const verdaechtig = [`

```text
Zwei Formen, beide OHNE Fenster — ein Fenster von 200 Zeichen hat beim
ersten Versuch quer über den Zeilenumbruch hinweg den FILTER-Parameter
(`spare === '1'`) mitgefangen und drei von vier Treffern waren falsch.

  a) ein Vergleich direkt auf is_spare — deckt `p.is_spare === 't'`
     genauso ab wie `ip.is_spare='t'` in SQL
  b) irgendein Vergleich gegen 'True' — diese Schreibweise kommt in
     diesem Baum ausschliesslich als Rebrickable-Wahrheitswert vor
     (nachgemessen: ausser in Kommentaren nirgends sonst)
```
