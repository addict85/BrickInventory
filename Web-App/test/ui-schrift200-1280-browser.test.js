/**
 * 1280 px and 200 % font (browser setting, Page.setFontSizes): every view in all six themes, light
 * and dark, measured as a desktop — no horizontal scroll, nothing cut off, no overlap, tap targets
 * ≥ 24 px (@einzeln: Chrome). Completes 320/390 px at 200 % and 320/390/1280 px at 100 %.
 *
 * Counter-check (22.11.2026, applied together): #wanted-xml-table again with its own scroll box at
 * large font and .role-word again overflow-wrap:anywhere with hyphens → red: „Einstellungen“
 * („Administrator“ 52 px wide, 5 lines) and „Wanted-XML“ (fields under the buttons).
 */
require('./helpers/ui-check').checkLargeFont('browser', 1280);
