'use strict';
/**
 * Vorgeladen in jede Testdatei (scripts/test-lauf.js, `--require`): Text auf
 * stdout geht nach stderr. node:test liest Berichtsrahmen und Text des Kindes
 * aus demselben Strom; folgt Text mit einem Nicht-ASCII-Byte an Stelle 2
 * („✅ …", „╔══…") im selben Lesestück direkt auf einen Rahmen, rechnet der
 * Leser (Node 22) dessen Länge vorzeichenbehaftet und deserialisiert den Text:
 * „Unable to deserialize cloned data". Rahmen sind Buffer, Text ist String.
 */
if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  const roh = process.stdout.write.bind(process.stdout);
  process.stdout.write = /** @type {typeof process.stdout.write} */ (function (stueck, ...rest) {
    // @ts-ignore — dieselben Überladungen wie stdout.write
    return typeof stueck === 'string' ? process.stderr.write(stueck, ...rest) : roh(stueck, ...rest);
  });
}
