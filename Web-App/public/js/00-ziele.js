// Sprungziele: Ein tieferes Modul öffnet eine Ansicht, die weiter oben liegt
// (das Set-Detail aus einer Erfassung, eine Sicht aus dem Router), ohne sie zu
// importieren. Die Ansicht meldet sich beim Laden hier an; ein Import in die
// Gegenrichtung gäbe einen Kreis im Modulgraphen.

/**
 * @typedef {object} Ziele
 * @property {(setNummer: string) => unknown} setDetail     Detail-Dialog eines Sets
 * @property {(name: string) => unknown} sicht              Reiter oder Sicht aus dem Benutzermenü
 * @property {(id: string) => unknown} einstAbschnitt       Abschnitt der Einstellungen
 */

/** @type {Partial<Ziele>} */
const _ziele = {};

/** @param {Partial<Ziele>} teil */
export function stelleZielBereit(teil) { Object.assign(_ziele, teil); }

/**
 * @template {keyof Ziele} K
 * @param {K} name
 * @param {Parameters<Ziele[K]>} args
 */
export function springe(name, ...args) {
  const ziel = /** @type {((...a: Parameters<Ziele[K]>) => unknown) | undefined} */ (_ziele[name]);
  if (!ziel) { console.warn('[ziele] nicht angemeldet:', name); return undefined; }
  return ziel(...args);
}

