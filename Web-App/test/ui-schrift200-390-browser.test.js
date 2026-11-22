/**
 * 390 px and 200 % base font of the page (as UI check 11 measured it):
 * at 320 px the set dialog already stacked, at 390 px image and
 * market price stood side by side and „Marktp…“, „712,4…“ was cut off
 * (@einzeln: Chrome).
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  container query „setdialog“ in mobile.css again @media (max-width: 18em)
 *      → red: „Set-Detail“ (cut off (frame): .wk-label, .wk-value …)
 *   B  referenceLine() without wrapping (one line, right-aligned) → red: „Finanzen“
 *      (cut off (chart): „Kaufpreis (nur bewertete …“)
 */
require('./helpers/ui-check').checkLargeFont('page', 390);
