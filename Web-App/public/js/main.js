// ── Einstiegspunkt des Frontend-Bündels ──────────────────────────────────────
//
// Seit der Umstellung auf ES-Module lädt index.html nur noch diese Datei (über
// das gebaute js/app.bundle.js). Module werden ausgeführt, wenn sie importiert
// werden — dieser Einstieg importiert deshalb alle Teile in genau der
// Reihenfolge, in der index.html sie früher als einzelne <script>-Tags
// eingebunden hat.
//
// ── Zur Reihenfolge ─────────────────────────────────────────────────────────
// Bei gegenseitigen Importen (01-core und 02-gallery brauchen einander)
// bestimmt nicht diese Liste die Auswertungsreihenfolge, sondern der
// Importgraph: Ein Modul wird ausgewertet, bevor das importierende Modul
// weiterläuft. Für Funktionsdeklarationen ist das unkritisch — sie sind
// gehoisted und über die Modulgrenze als "live binding" auch dann schon
// erreichbar, wenn das Zielmodul noch nicht fertig ausgewertet ist.
//
// Kritisch wäre nur, ein const aus einem anderen Modul WÄHREND der eigenen
// Top-Level-Auswertung zu lesen. Solche Stellen gibt es hier nicht; die
// Top-Level-Arbeit der Module beschränkt sich auf das Anhängen von
// Ereignisbehandlern und die Registrierung beim Dispatcher.
import '../i18n.js';
import './01-core.js';
import './01-bausteine.js';
import './02-gallery.js';
import './03-parts.js';
import './04-finance.js';
import './05-settings.js';
import './06-minifigs.js';
import './07-admin.js';
import './08-init.js';
import './09-catalog.js';
import './10-mobile.js';
import './11-actions.js';
import './12-pdfviewer.js';
import './13-acquisition-modals.js';
import './14-scope.js';
import './15-scrollbar.js';

// ── Start ────────────────────────────────────────────────────────────────────
// Erst NACH der Auswertung aller Module. Vorher lag der Aufruf im Rumpf von
// 08-init.js und lief dadurch, während i18n.js noch nicht ausgewertet war —
// siehe die Begründung dort.
import { startApp } from './08-init.js';
startApp();
