/**
 * Der Vertrag einer Route aus src/vertrag/, gefunden über den Pfad, wie
 * die App ihn schreibt ({setNumber}); Express nennt die Platzhalter :setNumber,
 * und die Namen dürfen abweichen ({id} gegen :acqId).
 */

/** @param {string} p */
const gleichfoermig = p => p.replace(/\{\w+\}|:\w+/g, '{}');

/**
 * @param {(rel: string) => any} _req  buildAndRequire() der Testdatei
 * @param {string} methode
 * @param {string} pfad
 * @returns {{ antwort?: import('zod').ZodType, eingabe?: import('zod').ZodType } | undefined}
 */
function vertragZu(_req, methode, pfad) {
  const { VERTRAG } = _req('src/vertrag/index.js');
  const treffer = Object.entries(VERTRAG).filter(([k]) => {
    const [m, p] = k.split(' ');
    return m === methode && gleichfoermig(p) === gleichfoermig(pfad);
  });
  return treffer.length === 1 ? treffer[0][1] : undefined;
}

/**
 * Was die Android-App vom Server braucht (shared/app-schnittstelle.json, erzeugt aus ihrem
 * Quelltext): Routen mit Abfrage und Rumpffeldern, dazu die Antwortfelder, die sie liest.
 * @returns {{ routen: { methode: string, pfad: string, typ: string | null, abfrage: { name: string, pflicht: boolean }[], rumpf: string | null, rumpffelder: string[] }[], adressen: string[], antwortfelder: string[], modelle: Record<string, { felder: string[], pflicht: string[] }> }}
 */
function appSchnittstelle() {
  const datei = require('node:path').join(__dirname, '..', '..', '..', 'shared', 'app-schnittstelle.json');
  return JSON.parse(require('node:fs').readFileSync(datei, 'utf8'));
}

module.exports = { vertragZu, gleichfoermig, appSchnittstelle };
