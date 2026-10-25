# Begründungen zu `utils/loginLimiter.ts`

Die ausführlichen Kommentare aus `utils/loginLimiter.ts`, wörtlich. Im Code steht je
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

<a id="ipof"></a>
## `_ipOf`

```text
VORHER: der ERSTE Eintrag aus dem rohen X-Forwarded-For-Header, ungeprüft.
Der Header kommt vom CLIENT, nicht vom Proxy — jeder darf ihn mitschicken.
Ein Angreifer, der bei jedem Versuch einen anderen (frei erfundenen) Wert
sendet, bekommt bei jedem Versuch einen frischen Rate-Limit-Bucket; die
"5 Fehlversuche, dann 15 Min Sperre"-Regel griff dadurch nie.

server.ts setzt bereits `app.set('trust proxy', 1)` in Produktion — Express
wertet X-Forwarded-For damit selbst aus (genau ein Hop, der eigene
Reverse-Proxy) und legt das Ergebnis in req.ip ab. req.ip ist deshalb die
vertrauenswürdige Quelle; der Header-Zugriff bleibt nur als Fallback für
Kontexte ohne Express-Request (aktuell keine), falls req.ip einmal fehlt.
```
