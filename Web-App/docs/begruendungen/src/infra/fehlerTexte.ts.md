# Begründungen zu `src/infra/fehlerTexte.ts`

Die ausführlichen Kommentare aus `src/infra/fehlerTexte.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="sprache"></a>
## `Sprache`

```text
Die Fehlermeldungen des Servers — an EINER Stelle, in beiden Sprachen.

── Der Befund (Nachtrag 130) ───────────────────────────────────────────────

Beide Oberflächen sind zweisprachig: Die Webapp hat 724 Übersetzungszeilen,
die Android-App 452 Texte. Der Server, der sie füttert, sprach nur Deutsch —
GEMESSEN: 125 Stellen schickten eine feste Zeichenkette, 80 verschiedene
Texte, davon 54 eindeutig deutsch. Und beide Clients zeigen sie unverändert
an:

    Webapp   err.textContent = d.error || t('settings.error')
    App      _snackbar.value = r.data.error ?: text(R.string.…)

Ein englischsprachiger Nutzer hatte damit eine vollständig englische
Oberfläche — bis etwas schiefging. Dann stand dort „Benutzername bereits
vergeben". In beiden Apps, gleichermassen.

── Warum die Sprache in der ANFRAGE steht und nicht am Konto ───────────────

Der erste Entwurf war: Der Server schickt nur einen Schlüssel, und beide
Oberflächen übersetzen ihn selbst. Das hätte jeden dieser Texte DREIMAL
gebraucht — hier, in public/locales/*.js und in beiden strings.xml. 80 Texte
mal drei Orte mal zwei Sprachen: 480 Stellen, die auseinanderlaufen können.
Genau die Form, gegen die dieser Baum an einem Dutzend Stellen ankämpft.

Deshalb andersherum: Der Client sagt in jeder Anfrage, welche Sprache er
gerade ZEIGT (`Accept-Language`), und bekommt den Text darin. Die Tabelle
steht einmal.

Nicht die Spracheinstellung des KONTOS, obwohl der Server sie kennt: Die
Android-App lässt ihre Sprache unabhängig davon umstellen (per-App-Locale
seit Android 13), und ein Nutzer mit deutschem Konto auf einem englischen
Telefon bekäme sonst deutsche Fehler in einer englischen Oberfläche.

── `error` bleibt trotzdem ein Satz ────────────────────────────────────────

Die Antwort trägt zusätzlich `code`. Wer will, kann darauf reagieren, statt
Text zu vergleichen — aber `error` bleibt ein fertiger Satz, weil eine
bereits installierte App-Version genau den anzeigt. Ein Schlüssel allein
hätte dort „benutzername_vergeben" auf den Bildschirm gebracht.

── Platzhalter ─────────────────────────────────────────────────────────────

`{name}` wird aus dem `vars`-Objekt ersetzt. Bewusst benannt und nicht
nummeriert: Im Deutschen und im Englischen steht dasselbe Stück oft an
verschiedener Stelle im Satz.
```

<a id="fehler"></a>
## `FEHLER`

```text
Der Katalog.

Zusammengeführt wurde dabei, was mehrfach dastand: „Kein Schreibrecht für
dieses Konto." stand an SECHS Stellen, „Keine Datei" an fünf, „Ungültiger
oder abgelaufener Token" an vier (einmal mit und einmal ohne Schlusspunkt),
und „Nur Admins" / „Nur für Admins" waren zwei Schreibweisen derselben
Absage. 80 Texte an 125 Stellen sind jetzt 76 Einträge.
```

<a id="antwortsprache"></a>
## `antwortSprache`

```text
Welche Sprache will dieser Anfragende sehen?

Aus `Accept-Language`, weil das der Client bei JEDER Anfrage mitschickt und
es die Sprache ist, die er GERADE zeigt. Kein Treffer → Deutsch, wie bisher.

Bewusst kein Auswerten der Gewichtungen (`de;q=0.9, en;q=0.8`): Es gibt zwei
Sprachen, und beide Clients schicken genau eine. Ein vollständiger Parser
wäre Aufwand für einen Fall, den dieses Projekt nicht hat.
```

<a id="fehlerwerfen"></a>
## `fehlerWerfen`

```text
Einen Fehler WERFEN, der seinen Grund als Code traegt.

Fuer Helfer, die tief in einem Vorgang stecken und keine Antwort schreiben
(utils/household.ts, utils/setMove.ts): Sie werfen, die Route faengt, und
handleRouteError macht daraus die Antwort — in der Sprache des Anfragenden,
sofern es den Request kennt.

Nur fuer Faelle, die der NUTZER lesen soll. Ein technischer Fehler (Treiber,
Netz) bleibt ein gewoehnlicher Error: handleRouteError ersetzt seine Meldung
bei 5xx in der Produktion ohnehin durch einen allgemeinen Satz.
```

<a id="fehlertext"></a>
## Abschnitt

```text
── Warum hier gefragt wird, ob es den Eintrag gibt ─────────────────────

Vorher stand hier `eintrag[sprache]` ohne Pruefung. Ein Code, den die
Tabelle nicht kennt, endete damit als `TypeError: Cannot read properties
of undefined (reading 'de')` — und weil das IM Fehlerpfad passiert, sah
der Benutzer statt der Absage ein HTTP 500. Genau so ist Marcos
Einladungscode gescheitert (Nachtrag 167): Dort ging ein Zufallstoken als
Fehlercode herein.

Eine Fehlermeldung ist das Letzte, was selbst noch abstuerzen darf. Der
Code wird deshalb notfalls im Klartext durchgereicht: unschoen, aber
lesbar — und er sagt dem Protokoll, welcher Eintrag fehlt.
```
