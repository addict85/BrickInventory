/**
 * Das Bündel (public/js/app.bundle.js) ist ein Erzeugnis und nicht in git.
 * Jeder Test, der es liest oder einen Server mit Oberfläche startet, holt es
 * hier; der Bau selbst steht nur in scripts/build-frontend.js.
 */
const path = require('node:path');
const { OUT_REL, stelleBuendelSicher } = require('../../scripts/build-frontend');

const BUENDEL = path.join(__dirname, '..', '..', 'public', OUT_REL);

module.exports = { BUENDEL, stelleBuendelSicher };
