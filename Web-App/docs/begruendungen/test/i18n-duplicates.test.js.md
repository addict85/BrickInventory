# Begründungen zu `test/i18n-duplicates.test.js`

Die ausführlichen Kommentare aus `test/i18n-duplicates.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Doppelte Übersetzungsschlüssel.

In einem JavaScript-Objektliteral gewinnt bei einem doppelten Schlüssel
stillschweigend der SPÄTERE Eintrag. In public/i18n.js waren fünf Schlüssel
je Sprache doppelt vergeben (login.password, login.forgot, figs.stat.types,
partslist.reset, common.network_error) — mit teils UNTERSCHIEDLICHEN Texten:
'Typen' gegen 'Figurtypen', 'Zurücksetzen' gegen '🗑️ Zurücksetzen'.

Der Effekt: Wer den früheren Eintrag ändert, sieht keine Wirkung. Genau die
Sorte Beobachtung, die man sich als eigenen Fehler erklärt.

Aufgefallen ist das erst, als scripts/build-frontend.js die Dateien für das
Bündel durch esbuild geschickt hat — der Minifizierer warnt davor.
```

<a id="keysof"></a>
## `function keysOf(lang) {`

```text
Liest die Schlüssel einer Sprachdatei aus der QUELLE.

Bewusst textuell statt per require(): Ein geladenes Objekt hätte die
Duplikate schon aufgelöst — also genau die Information verloren, um die es
hier geht. Seit die Wörterbücher in public/locales/{de,en}.js liegen, ist je
Sprache eine eigene Datei zu lesen; die frühere Klammer-Zählerei über den
de:/en:-Block entfällt damit.
```
