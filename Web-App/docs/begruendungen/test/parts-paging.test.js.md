# Begründungen zu `test/parts-paging.test.js`

Die ausführlichen Kommentare aus `test/parts-paging.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stripmodulesyntax"></a>
## `function stripModuleSyntax(src) {`

```text
import-/export-Syntax aus einer Moduldatei entfernen.

Diese Tests werten den Quelltext in einer vm-Sandbox bzw. in jsdom als
KLASSISCHES Skript aus. Seit der Umstellung auf ES-Module enthalten die
Dateien import- und export-Anweisungen, die dort einen SyntaxError erzeugen
("Cannot use import statement outside a module"). Die geprüfte Logik ändert
sich dadurch nicht — nur die Modulverpackung muss weg.
```

<a id="registeractions"></a>
## `return 'function registerActions() {}\n'`

```text
registerActions() kommt sonst aus js/00-registry.js und ist nach dem
Entfernen der Importe nicht definiert. In der Sandbox interessiert die
Anmeldung nicht — dass sie aufgerufen WIRD, prüfen test/csp-actions.test.js
und test/bundle-smoke.test.js gegen den echten Quelltext.
tRaw() lebt in i18n.js und wird hier nicht mitgeladen. In der Sandbox
genügt die Weiterleitung an t(): Der Unterschied liegt allein in der
Maskierung der eingesetzten Werte, die diese Tests nicht prüfen.
```
