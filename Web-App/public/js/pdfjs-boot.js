// Neueste PDF.js (ESM). Global bereitstellen, damit die klassischen
// App-Skripte (public/js/*.js) sie via window.pdfjsLib nutzen können.
//
// Lag früher als <script type="module"> direkt in index.html. Mit der
// geschlossenen CSP (script-src ohne 'unsafe-inline') wurde der Block
// blockiert — als eigene Datei ist er von 'self' gedeckt.
import * as pdfjsLib from '/vendor/pdfjs/pdf.min.mjs?v=6.1.200';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs?v=6.1.200';
window.pdfjsLib = pdfjsLib;
