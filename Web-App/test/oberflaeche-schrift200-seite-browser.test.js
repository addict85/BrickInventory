/**
 * 320 px und 200 % Grundschrift der Seite (html font-size, so hat die
 * UI-Prüfung gemessen): Media-Abfragen sehen diese Vergrösserung nicht, die
 * Container-Abfragen der Leiste und des Inhalts schon (@einzeln: Chrome).
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  Container-Abfrage der Leiste wirkungslos (max-width: 1px) → rot: jede Ansicht
 *      („Leiste: „Sammlung“ abgeschnitten“ …)
 *   B  main ohne container haupt → rot: „Finanzen“, „Merkliste“, „Einstellungen“,
 *      alle Sichten aus dem Menü (Überlauf)
 */
require('./helpers/oberflaeche-pruefung').pruefeGrosseSchrift('seite');
