# Begründungen zu `utils/indexHtml.ts`

Die ausführlichen Kommentare aus `utils/indexHtml.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Auslieferung der index.html mit bereits gesetztem data-theme.

Warum überhaupt: Das Design ist eine globale Einstellung und muss auch vor
dem Login gelten. js/00-theme-boot.js löst das clientseitig über einen
localStorage-Cache plus Abgleich mit dem Server — mit einer Lücke: Beim
allerersten Aufruf in einem Browser ist der Cache leer, die Seite startet
ohne data-theme (= classic) und springt nach dem Abgleich sichtbar um.

Steht der richtige Wert schon im ausgelieferten HTML, entfällt der Sprung
ganz — und das Boot-Skript kann seinen Abgleich überspringen, spart also
zusätzlich eine Anfrage pro Seitenaufruf.

Zwei Caches, beide bewusst klein gehalten:
  • Der Dateiinhalt wird einmal gelesen. In Produktion ändert sich die Datei
    nur beim Deploy; ausserhalb von Produktion wird die mtime geprüft, damit
    Änderungen ohne Neustart ankommen.

    Hier stand „und der Versions-Bumper läuft vor dem Serverstart". Das war
    eine ANNAHME, und sie ist gebrochen: scripts/bump-version.js hängt an
    `npm postinstall` und am Docker-Build — wer `git pull` macht und neu
    startet, bekommt ihn nicht. Marcos Browser hielt deshalb ein sechs Tage
    altes styles.css fest. Seither leitet src/infra/assetStempel.ts den `?v=`
    aus den Dateien selbst ab; die Annahme wird nicht mehr gebraucht.
  • Der Theme-Wert wird gecacht und beim Speichern invalidiert
    (invalidateTheme() in routes/settings.ts) — kein DB-Treffer pro Aufruf.
```

<a id="currentlang"></a>
## `currentLang`

```text
Sprache des angemeldeten Nutzers. Ohne Session (Login-Seite) 'de'.

Der Wert entscheidet nur, WELCHE Sprachdatei im ausgelieferten HTML steht.
Liegt der Nutzer daneben — etwa weil er vor dem Login auf Englisch gestellt
hat —, holt loadLang() in i18n.js die richtige Datei zur Laufzeit nach. Es
geht hier also um das Einsparen einer Anfrage im Normalfall, nicht um
Korrektheit.

@param {number|undefined} userId
@returns {Promise<string>}
```

<a id="renderindexhtml"></a>
## `renderIndexHtml`

```text
Liefert die index.html mit gesetztem data-theme auf dem <html>-Element und
der passenden Sprachdatei im <head>.

Schlägt irgendetwas fehl, kommt die Datei unverändert zurück — dann greift
wieder das Boot-Skript bzw. die voreingestellte Sprachdatei, also der
Zustand von vorher.

@param {number} [userId] Angemeldeter Nutzer, für die Sprachauswahl
```
