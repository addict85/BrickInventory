# Begründungen zu `test/app-endpunkte.test.js`

Die ausführlichen Kommentare aus `test/app-endpunkte.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jede Adresse, die die Android-App aufruft, muss es auf dem Server geben.

── Der Befund ──────────────────────────────────────────────────────────────
NACHGEMESSEN: BrickApiService.kt deklarierte
`GET api/settings/admin/default-condition`. Diese Route ist in Etappe 7
gelöscht worden — an ihrer Stelle steht in routes/settings.ts nur noch ein
Kommentar, der auf /api/v1/settings/default-condition verweist. Die
Deklaration blieb stehen und sah aus wie ein unterstützter Aufruf.

Hier ging nichts kaputt, weil sie niemand aufrief. Genau das ist der Punkt:
Der nächste, der die Methode benutzt, bekommt 404 — und sucht den Fehler in
seinem eigenen Code, denn die Schnittstelle behauptet ja, es gäbe die Route.

── Warum auf der Webapp-Seite ──────────────────────────────────────────────
Die Prüfung braucht BEIDE Bäume. Die Android-Tests laufen nur im
GitHub-Lauf (rund zehn Minuten); `npm test` läuft vor jedem Commit. Eine
Prüfung, die man selten ausführt, findet selten etwas.

── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
Beide Seiten werden geparst: die Routen aus den Router-Dateien, die
Aufrufe aus den Retrofit-Anmerkungen. Eine neue Methode in der App ist von
selbst mitgeprüft. Selbstbeweis über Mindestzahlen — greift ein Muster
nicht mehr, wären beide Mengen leer und der Test grün, ohne etwas geprüft
zu haben.
```

<a id="stelle"></a>
## `{`

```text
── Routen, die DIREKT an der App haengen (Nachtrag 136) ──────────────────

`serverRouten()` las nur `router.<verb>('<pfad>')` aus den Router-Dateien.
Zwei Adressen stehen aber in server.ts unmittelbar an der App:

    app.get('/api/v1/startup-status', …)
    app.get('/api/v1/health', …)

Beide absichtlich dort und absichtlich vor allen Waechtern — sie werden
gebraucht, BEVOR sich jemand anmelden kann. Dieselbe Sorte Luecke, die
dieser Baum immer wieder hat: eine Sache in zwei Schreibweisen und eine
Suche, die nur eine kennt.

Aufgefallen, als die App den Startzustand zu rufen begann: Der Test meldete
„der Server hat sie nicht", obwohl die Route seit jeher da ist.
```
