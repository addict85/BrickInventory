# Begründungen zu `src/konto/loginLimiter.ts`

Die ausführlichen Kommentare aus `src/konto/loginLimiter.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Brute-Force-Schutz für Login-Endpunkte und missbrauchsanfällige Routen.

── Warum jetzt in der Datenbank ────────────────────────────────────────────
Die Zähler lagen bisher im Prozessspeicher. Der Server läuft im Cluster mit
WEB_WORKERS Prozessen (Vorgabe: Anzahl CPU-Kerne), und jede Anfrage kann in
einem beliebigen davon landen. Aus "5 Fehlversuche" wurden damit faktisch
N×5 — auf einem Achtkerner also vierzig. Der Kommentar hier nannte das
"völlig ausreichend"; das stimmt für gelegentliches Raten, nicht für einen
automatisierten Angriff.

Jetzt zählt eine gemeinsame Tabelle. Kosten: ein Primärschlüssel-Lookup pro
Login-Versuch und ein UPSERT je Fehlversuch. Das Hochzählen passiert atomar
in einem Statement — ohne SELECT-dann-UPDATE und damit ohne Race zwischen
parallelen Versuchen.

── Rückfallebene ───────────────────────────────────────────────────────────
Ist die Datenbank nicht erreichbar, greift der alte In-Memory-Zähler. Lieber
ein schwächeres Limit als ein Login, der gar nicht mehr funktioniert.
```

<a id="zaehlerstand"></a>
## `Zaehlerstand`

```text
── Warum hier Typen stehen (Nachtrag 155) ───────────────────────────────────

Diese Datei entscheidet, ob ein Anmeldeversuch durchgelassen wird. Sie hatte
20 implizite `any`. Ein vertippter Feldname (`st.cnt` statt `st.count`) ergibt
dort `undefined`, und `undefined >= MAX_ATTEMPTS` ist `false` — die Sperre
faellt still aus, und nichts im Protokoll sagt es. Genau diese Fehlerklasse
faengt eine Typpruefung, und genau hier ist sie am meisten wert.
```
