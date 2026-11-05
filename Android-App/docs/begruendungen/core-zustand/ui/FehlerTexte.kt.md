# Begründungen zu `core-zustand/ui/FehlerTexte.kt`

Die ausführlichen Kommentare aus `core-zustand/src/main/java/ch/brickinventoryapp/ui/FehlerTexte.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="fehlertextid"></a>
## `fehlerTextId`

```text
Welche Textressource gehört zu welcher [Fehlerart]? Eine eigene, reine Funktion
statt einer Zeile in `meldung()`, damit die Zuordnung ohne `Context` und ohne
Android-Laufzeit prüfbar ist. `meldung()` holt den Satz und bevorzugt die
Servermeldung — das braucht einen Context, die Zuordnung nicht.

Kein `else`-Zweig: Eine neue Fehlerart soll den Build hier brechen, nicht still
in einem Sammelfall landen — wie bei
[ch.brickinventoryapp.data.repository.Result].
```

<a id="mittechnischerursache"></a>
## `mitTechnischerUrsache`

```text
Die technische Ursache anhängen — aber nur, wo der Satz allein nichts sagt.

Nur bei [Fehlerart.UNBEKANNT], dem Auffangzweig in RepoBasis für jede geworfene
Ausnahme. Ursachen mit eigenem, verständlichem Satz (kein Netz,
Zeitüberschreitung, Sitzung abgelaufen, Serverfehler mit Code) bekommen keinen
englischen Bibliothekstext — „Socket closed“ ist kein Satz an einen Menschen.
„Etwas ist schiefgelaufen“ benennt dagegen nichts; dort ist der Bibliothekstext
das Einzige, was etwas aussagt, und ohne ihn bliebe Nutzer wie Entwickler nur
Raten.
```
