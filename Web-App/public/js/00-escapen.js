// ── Maskieren: EINE Fassung, und zwar ohne Dokument ─────────────────────────
//
// Hier stand esc() bis zum 20.10. in js/01-core.js, zusammen mit api(), Auth
// und den Panels. Das ging, solange nur Oberflächencode maskierte.
//
// ── Warum es umgezogen ist ──────────────────────────────────────────────────
//
// js/19-bricklink-xml.js baut die Wanted-Liste für BrickLink und muss ihre
// drei Textfelder maskieren. Es ist aber bewusst DOM-FREI, damit sich das
// Format prüfen lässt (test/bricklink-wanted-xml.test.js liest es ein wie ein
// gewöhnliches Modul). js/01-core.js greift beim Laden auf `document` zu —
// GEMESSEN: `import('./public/js/01-core.js')` in node endet mit „document is
// not defined". Es von dort zu holen hiesse, ein reines Datenmodul an die
// Oberfläche zu hängen.
//
// Die Gegenrichtung — einen zweiten Maskierer daneben zu schreiben — verbietet
// dieser Baum ausdrücklich, und zu Recht: test/wunschliste-xml.test.js hält
// fest, dass genau diese Doppelung schon einmal zugeschlagen hat (die
// Android-App maskierte, die Webapp nicht, und niemandem fiel es auf, solange
// die Teilenummern zufällig harmlos waren).
//
// Also: eine Fassung, an einem Ort, den beide Seiten erreichen. js/01-core.js
// führt sie weiterhin aus — jeder bestehende `import { esc } from
// './01-core.js'` gilt unverändert.

/**
 * Text für HTML und XML sicher machen: die fünf Entitäten.
 *
 * `&` ZUERST, sonst verdoppelt es die folgenden: aus `<` würde erst `&lt;`
 * und daraus `&amp;lt;` — angezeigt würde wörtlich „&lt;".
 *
 * `&#39;` statt `&apos;` für den Apostroph: Beides ist in XML gültig, die
 * numerische Form zusätzlich in HTML 4. Eine Form, beide Verwendungen.
 */
export function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
