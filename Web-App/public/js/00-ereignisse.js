// Ereignisse zwischen den Modulen. Ein tieferes Modul meldet, was geschehen ist; wer darauf reagieren muss,
// hört zu. So braucht der Kern (API-Hülle, Fortschritt, Papierkorb) keinen Import der Ansichten, die neu
// laden. Zugestellt wird synchron in der Reihenfolge des Abonnierens.

/**
 * Name → Nutzlast. Ein neues Ereignis wird hier eingetragen; Tippfehler im Namen oder eine falsche Nutzlast
 * meldet dann die Typprüfung.
 * @typedef {object} Ereignisse
 * @property {string} sitzungBeendet        Pfad des Aufrufs, der mit 401 endete
 * @property {undefined} passwortWechselNoetig
 * @property {undefined} zweiterFaktorPflicht  Verwalter ohne zweiten Faktor: nur dessen Einrichtung ist erlaubt
 * @property {undefined} setsGeaendert      Sets sind anders als angezeigt (Import fertig oder abgebrochen)
 * @property {undefined} bestandGeaendert   Sets, Teile und Figuren sind anders als angezeigt (Wiederherstellung)
 * @property {string} ansichtGewechselt     Name des Reiters oder der Sicht
 * @property {undefined} filterZurueckgesetzt
 * @property {undefined} abschnittGewechselt
 * @property {{ sprache: string, speichern: boolean, echterWechsel: boolean }} spracheGewechselt
 */

/** @type {Map<string, Set<(daten: unknown) => void>>} */
const _hoerer = new Map();

/**
 * @template {keyof Ereignisse} K
 * @param {K} name
 * @param {(daten: Ereignisse[K]) => void} fn
 * @returns {() => void} hebt das Abonnement wieder auf
 */
export function abonniere(name, fn) {
  let liste = _hoerer.get(name);
  if (!liste) { liste = new Set(); _hoerer.set(name, liste); }
  const hoerer = /** @type {(daten: unknown) => void} */ (fn);
  liste.add(hoerer);
  return () => { liste.delete(hoerer); };
}

/**
 * Ein Fehler in einem Hörer hält die übrigen nicht auf; er geht an das Auffangnetz für unbehandelte Fehler
 * (08-init.js).
 * @template {keyof Ereignisse} K
 * @param {K} name
 * @param {Ereignisse[K]} [daten]
 */
export function melde(name, daten) {
  for (const fn of [...(_hoerer.get(name) ?? [])]) {
    try { fn(daten); } catch (e) { setTimeout(() => { throw e; }); }
  }
}
