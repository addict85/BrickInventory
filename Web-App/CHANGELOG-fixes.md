# Security-, Performance- und Architektur-Fixes

Was in den Review-Durchgängen gefunden und behoben wurde — ein Abschnitt je
Befund, mit Ursache, Behebung und der Prüfung, die den Rückfall verhindert.

Jeder Eintrag ist gegen `npx tsc --noEmit` und die volle Suite gegen ein echtes
PostgreSQL 16 verifiziert (`TEST_DATABASE_URL` + `REQUIRE_DB=1`).

---

## Wo steht was

Die Historie lag bis Nachtrag 147 als EINE Datei von 640 KB vor. Das war kein
Schönheitsfehler: Jeder Editor und jede Vorschau lud sie ganz, und wer einen
Nachtrag suchte, scrollte durch 14'000 Zeilen. Sie liegt jetzt als Teile im
Ordner `CHANGELOG/`; der Inhalt ist unverändert, nur aufgeteilt.

| Datei | Inhalt | Spanne | Abschnitte | Grösse |
|---|---|---|---|---|
| [01-frueh-1.md](CHANGELOG/01-frueh-1.md) | Vor der Nummerierung, Teil 1 | — | 30 | 75 KB |
| [02-frueh-2.md](CHANGELOG/02-frueh-2.md) | Vor der Nummerierung, Teil 2 | — | 30 | 49 KB |
| [03-frueh-3.md](CHANGELOG/03-frueh-3.md) | Vor der Nummerierung, Teil 3 | — | 30 | 46 KB |
| [04-frueh-4.md](CHANGELOG/04-frueh-4.md) | Vor der Nummerierung, Teil 4 | — | 30 | 64 KB |
| [05-frueh-5.md](CHANGELOG/05-frueh-5.md) | Vor der Nummerierung, Teil 5 | — | 30 | 69 KB |
| [06-frueh-6.md](CHANGELOG/06-frueh-6.md) | Vor der Nummerierung, Teil 6 | — | 7 | 16 KB |
| [07-nachtraege-001-025.md](CHANGELOG/07-nachtraege-001-025.md) | Nachträge 1–25 | Nachtrag 2–25 | 24 | 78 KB |
| [08-nachtraege-026-050.md](CHANGELOG/08-nachtraege-026-050.md) | Nachträge 26–50 | Nachtrag 26–50 | 22 | 55 KB |
| [09-nachtraege-051-075.md](CHANGELOG/09-nachtraege-051-075.md) | Nachträge 51–75 | Nachtrag 51–75 | 13 | 23 KB |
| [10-nachtraege-076-100.md](CHANGELOG/10-nachtraege-076-100.md) | Nachträge 76–100 | Nachtrag 78–100 | 23 | 62 KB |
| [11-nachtraege-101-125.md](CHANGELOG/11-nachtraege-101-125.md) | Nachträge 101–125 | Nachtrag 101–125 | 25 | 63 KB |
| [12-nachtraege-126-150.md](CHANGELOG/12-nachtraege-126-150.md) | Nachträge 126–150 | Nachtrag 127–147 | 17 | 42 KB |

### Suchen

Über alle Teile hinweg, z.B. nach einem Dateinamen oder einer Fehlermeldung:

```sh
grep -rn "getCurrentFigMarketPrice" CHANGELOG/
```

Einen bestimmten Nachtrag öffnen:

```sh
grep -rln "^## Nachtrag 129" CHANGELOG/
```

### Wohin ein neuer Eintrag gehört

In die Datei, deren Spanne die Nummer enthält. Erreicht ein Nachtrag eine neue
Fünfundzwanziger-Grenze (151, 176, …), kommt eine neue Datei nach demselben
Muster dazu und diese Tabelle bekommt eine Zeile. `test/changelog-index.test.js`
hält beides zusammen: Jede Datei in `CHANGELOG/` muss hier stehen, jede Zeile
hier muss eine Datei haben, und die Nummern dürfen sich nicht überschneiden.
