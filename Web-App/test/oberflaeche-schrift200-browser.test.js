/**
 * 320 px und 200 % Schrift (Browsereinstellung, Page.setFontSizes): jede Ansicht
 * in allen sechs Designs, hell und dunkel — kein Überlauf, nichts abgeschnitten,
 * keine Überlappung, ganze Beschriftungen in der unteren Leiste (@einzeln: Chrome).
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  Import-Menü wieder ohne flex 1 1 100 % im schmalen Inhalt → rot: „Sammlung“,
 *      „Teile“, „Minifiguren“, „Import-Menü“ u. a. (brick: Überlauf 5 px)
 *   B  Lagerortfeld nicht über die ganze Zeile → rot: „Sicht lagerorte“ (Tippziel 28 px)
 */
require('./helpers/oberflaeche-pruefung').pruefeGrosseSchrift('browser');
