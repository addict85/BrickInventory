/**
 * 320 px and 200 % base font of the page (html font-size, as the
 * UI check measured): media queries do not see this enlargement, the
 * container queries of the bar and the content do (@einzeln: Chrome).
 *
 * Counter-checks (measured 03.11.2026, each on its own):
 *   A  container query of the bar ineffective (max-width: 1px) → red: every view
 *      („Leiste: „Sammlung“ abgeschnitten“ …)
 *   B  main without container haupt → red: „Finanzen“, „Merkliste“, „Einstellungen“,
 *      all views from the menu (overflow)
 */
require('./helpers/ui-check').checkLargeFont('seite');
