// Hier stand esc() bis zum 20.10. in js/01-core.js, zusammen mit api(), Auth
// und den Panels. Das ging, solange nur Oberflächencode maskierte.
// Ausführlich: docs/begruendungen/public/js/00-escapen.js.md#hier-stand-esc-bis-zum-20-10-in-js-01-co

/**
 * Text für HTML und XML sicher machen: die fünf Entitäten.
 *
 * `&` ZUERST, sonst verdoppelt es die folgenden: aus `<` würde erst `&lt;`
 * und daraus `&amp;lt;` — angezeigt würde wörtlich „&lt;".
 *
 * `&#39;` statt `&apos;` für den Apostroph: Beides ist in XML gültig, die
 * numerische Form zusätzlich in HTML 4. Eine Form, beide Verwendungen.
 * @param {unknown} s
 */
export function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
