/**
 * Der Vertrag einer Route aus src/infra/vertrag/, gefunden über den Pfad, wie
 * die App ihn schreibt ({setNumber}); Express nennt die Platzhalter :setNumber,
 * und die Namen dürfen abweichen ({id} gegen :acqId).
 */

/** @param {string} p */
const gleichfoermig = (p) => p.replace(/\{\w+\}|:\w+/g, '{}');

/**
 * @param {(rel: string) => any} _req  buildAndRequire() der Testdatei
 * @param {string} methode
 * @param {string} pfad
 * @returns {{ antwort?: import('zod').ZodType, eingabe?: import('zod').ZodType } | undefined}
 */
function vertragZu(_req, methode, pfad) {
  const { VERTRAG } = _req('src/infra/vertrag/index.js');
  const treffer = Object.entries(VERTRAG).filter(([k]) => {
    const [m, p] = k.split(' ');
    return m === methode && gleichfoermig(p) === gleichfoermig(pfad);
  });
  return treffer.length === 1 ? treffer[0][1] : undefined;
}

module.exports = { vertragZu, gleichfoermig };
