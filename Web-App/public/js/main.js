// Einstiegspunkt des Bündels und die explizite Ladereihenfolge: Kern, Bausteine, Ansichten (Schichten in
// scripts/build-frontend.js). Jede Datei unter js/ steht hier, weil das Bündel-Skript die Vollständigkeit am
// Einstieg prüft. Der Importgraph ist kreisfrei (test/frontend-architektur.test.js).

// Kern
import './stile.js';
import './escapen.js';
import './ereignisse.js';
import './ziele.js';
import './zustand.js';
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
import './gallery.js';
import './set-csv-import.js';
import './parts.js';
import './teil-erfassen.js';
import './wertkurve.js';
import './finance.js';
import './settings.js';
import './zugaenge.js';
import './haushalt.js';
import './nutzerverwaltung.js';
import './alarme.js';
import './lagerorte.js';
import './minifigs.js';
import './admin.js';
import './set-detail.js';
import './fehlerfang.js';
import './init.js';
import './catalog.js';
import './mobile.js';
import './actions.js';
import './pdfviewer.js';
import './kaufpreis-anzeige.js';
import './erfassung-zustand.js';
import './acquisition-modals.js';
import './manuell-detail.js';
import './set-teile.js';
import './scope.js';
import './scrollbar.js';
import './merkliste.js';
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
import './sitzung.js';
import './einrichtung-stand.js';

// Gestartet wird erst nach der Auswertung aller Module.
import { startApp } from './sitzung.js';
startApp();
