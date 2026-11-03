/**
 * 320 px bei normaler Schrift, englisch (Classic und Noppe): jede Ansicht ohne
 * Überlauf, Abschneiden, Überlappung und zu kleine Tippziele (@einzeln: Chrome).
 *
 * Gegenprobe (03.11.2026 gemessen): `.lager-sinnbild { min-width: 44px }` in
 * mobile.css entfernt → rot: „Sicht lagerorte“ (Tippziel 42 × 44).
 */
require('./helpers/oberflaeche-pruefung').pruefeGrosseSchrift('schmal');
