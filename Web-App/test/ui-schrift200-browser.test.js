/**
 * 320 px and 200 % font (browser setting, Page.setFontSizes): every view
 * in all six themes, light and dark — no overflow, nothing cut off,
 * no overlap, whole labels in the bottom bar (@einzeln: Chrome).
 *
 * Counter-checks (measured 03.11.2026, each on its own):
 *   A  import menu again without flex 1 1 100 % in the narrow content → red: „Sammlung“,
 *      „Teile“, „Minifiguren“, „Import-Menü“ and others (brick: overflow 5 px)
 *   B  storage location field not across the whole row → red: „Sicht lagerorte“ (tap target 28 px)
 */
require('./helpers/ui-check').checkLargeFont('browser');
