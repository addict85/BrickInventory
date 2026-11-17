// Einstiegspunkt des Bündels und die explizite Ladereihenfolge: Kern, Bausteine, Ansichten (Schichten in
// scripts/build-frontend.js). Jede Datei unter js/ steht hier, weil das Bündel-Skript die Vollständigkeit am
// Einstieg prüft. Der Importgraph ist kreisfrei (test/frontend-architektur.test.js).

// Kern
import './stile.js';
import './escapen.js';
import './events.js';
import './targets.js';
import './zustand.js';
import './load-guard.js';
import '../i18n.js';

// Bausteine
import './dom.js';
import './format.js';
import './meldungen.js';
import './verbindung.js';
import './api.js';
import './bilder.js';
import './formular.js';
import './konto.js';
import './dialoge.js';
import './fortschritt.js';
import './monitor.js';
import './bausteine.js';
import './rueckfrage.js';
import './fadenkreuz.js';
import './diagramme.js';

// Ansichten
import './detailfelder.js';
import './konten-orte.js';
import './sets-tabelle.js';
import './kennzahlen.js';
import './collection.js';
import './set-erfassen.js';
import './set-csv-import.js';
import './teile.js';
import './teil-erfassen.js';
import './wertkurve.js';
import './finances.js';
import './finanz-kennzahlen.js';
import './settings.js';
import './zugaenge.js';
import './haushalt.js';
import './user-management.js';
import './alarme.js';
import './lagerorte.js';
import './minifigs.js';
import './admin.js';
import './set-detail.js';
import './fehlerfang.js';
import './init.js';
import './katalog.js';
import './mobile.js';
import './aktionen.js';
import './pdfviewer.js';
import './kaufpreis-anzeige.js';
import './erfassung-zustand.js';
import './kauf-dialoge.js';
import './manuell-detail.js';
import './set-teile.js';
import './kontofilter.js';
import './rollbalken.js';
import './wanted.js';
import './gutscheine.js';
import './guthaben.js';
import './wanted-xml.js';
import './bricklink-xml.js';
import './papierkorb.js';
import './zweiter-faktor.js';
import './einrichtung.js';
import './passkeys.js';
import './router.js';
import './navigation.js';
import './startkasten.js';
import './maillink.js';
import './sitzung.js';
import './setup-status.js';

// Gestartet wird erst nach der Auswertung aller Module.
import { startApp } from './sitzung.js';
startApp();
