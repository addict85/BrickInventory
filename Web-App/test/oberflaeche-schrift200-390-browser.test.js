/**
 * 390 px und 200 % Grundschrift der Seite (wie die UI-Prüfung 11 gemessen hat):
 * Bei 320 px stapelte der Set-Dialog schon, bei 390 px standen Bild und
 * Marktpreis nebeneinander und „Marktp…“, „712,4…“ war abgeschnitten
 * (@einzeln: Chrome).
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  Container-Abfrage „setdialog“ in mobile.css wieder @media (max-width: 18em)
 *      → rot: „Set-Detail“ (abgeschnitten (Rahmen): .wk-label, .wk-wert …)
 *   B  bezugsLinie() ohne Umbruch (eine Zeile, rechtsbündig) → rot: „Finanzen“
 *      (abgeschnitten (Diagramm): „Kaufpreis (nur bewertete …“)
 */
require('./helpers/oberflaeche-pruefung').pruefeGrosseSchrift('seite', 390);
