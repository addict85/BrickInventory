// Latest PDF.js (ESM). Exposed globally so the classic app scripts (public/js/*.js) can use it via
// window.pdfjsLib.
//
// Used to sit as a <script type="module"> directly in index.html. With the locked-down CSP (script-src
// without 'unsafe-inline') that block was blocked — as its own file it is covered by 'self'.
import * as pdfjsLib from '/vendor/pdfjs/pdf.min.mjs?v=6.4.299';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs?v=6.4.299';
window.pdfjsLib = pdfjsLib;
