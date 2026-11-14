'use strict';
/**
 * Testdaten über die Dienste dieser Testdatei (testDienste()) statt rohem SQL: Konto,
 * Haushalt und Erfassung entstehen so, wie der Server sie anlegt (Protokoll, Haushaltsregeln,
 * Erfassung samt Bestandszeile). Ändert sich das Schema, folgt die Fabrik dem Dienst.
 * Erst nach buildAndRequire(); im Systemrahmen (helpers/systemrahmen.js) wie jede Testvorbereitung.
 */
const { testDienste } = require('./sources');

const PASSWORT = 'Fabrik-Passwort-2026';

/** Ein Konto über konto.legeKontoAn (ohne Verwalter: das Protokoll nennt keinen).
 * @param {string} name @param {{ verwalter?: boolean }} [o] @returns {Promise<number>} */
async function konto(name, o = {}) {
  const id = await testDienste().konto.legeKontoAn(null, name, PASSWORT, !!o.verwalter);
  if (id === null) throw new Error(`Konto „${name}“ gibt es schon`);
  return id;
}

/** Hängt `unter` an `haupt` wie in der Oberfläche: Einladung anlegen und einlösen.
 * @param {number} haupt @param {number} unter */
async function unterkonto(haupt, unter) {
  const h = testDienste().haushalt;
  const e = await h.einladungAnlegen(haupt);
  if (!e.code) throw new Error(`Einladung abgewiesen: ${e.fehler}`);
  const r = await h.einladungEinloesen(unter, e.code);
  if (r?.fehler) throw new Error(`Einlösen abgewiesen: ${r.fehler}`);
}

/** Ein Set mit einer Erfassung über sets.setErfassen, gebucht beim Konto `besitzer`.
 * @param {number} besitzer @param {string} setNumber
 * @param {{ menge?: number, preis?: number | null, zustand?: 'N' | 'U' }} [o] */
async function setErfasst(besitzer, setNumber, o = {}) {
  return testDienste().sets.setErfassen({
    anfragender: besitzer,
    besitzerWunsch: besitzer,
    setNumber,
    menge: o.menge ?? 1,
    kaufpreis: o.preis ?? null,
    zustand: o.zustand ?? 'N',
    wennVorhanden: 'aufstocken',
  });
}

module.exports = { konto, unterkonto, setErfasst, PASSWORT };
