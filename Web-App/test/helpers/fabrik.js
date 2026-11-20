'use strict';
/**
 * Testdaten über die Dienste dieser Testdatei (testServices()) statt rohem SQL: Konto,
 * Haushalt und Erfassung entstehen so, wie der Server sie anlegt (Protokoll, Haushaltsregeln,
 * Erfassung samt Bestandszeile). Ändert sich das Schema, folgt die Fabrik dem Dienst.
 * Erst nach buildAndRequire(); im Systemrahmen (helpers/systemrahmen.js) wie jede Testvorbereitung.
 */
const { testServices } = require('./sources');

const PASSWORT = 'Fabrik-Passwort-2026';

/** Ein Konto über konto.putAccountAn (ohne Verwalter: das Protokoll nennt keinen).
 * @param {string} name @param {{ verwalter?: boolean }} [o] @returns {Promise<number>} */
async function konto(name, o = {}) {
  const id = await testServices().konto.putAccountAn(null, name, PASSWORT, !!o.verwalter);
  if (id === null) throw new Error(`Konto „${name}“ gibt es schon`);
  return id;
}

/** Hängt `unter` an `haupt` wie in der Oberfläche: Einladung anlegen und einlösen.
 * @param {number} haupt @param {number} unter */
async function subAccount(haupt, unter) {
  const h = testServices().haushalt;
  const e = await h.createInvitation(haupt);
  if (!e.code) throw new Error(`Einladung abgewiesen: ${e.fehler}`);
  const r = await h.redeemInvitation(unter, e.code);
  if (r?.fehler) throw new Error(`Einlösen abgewiesen: ${r.fehler}`);
}

/** Ein Set mit einer Erfassung über sets.setErfassen, gebucht beim Konto `besitzer`.
 * @param {number} besitzer @param {string} setNumber
 * @param {{ menge?: number, preis?: number | null, zustand?: 'N' | 'U' }} [o] */
async function setRecorded(besitzer, setNumber, o = {}) {
  return testServices().sets.setErfassen({
    requester: besitzer,
    ownerWish: besitzer,
    setNumber,
    menge: o.menge ?? 1,
    kaufpreis: o.preis ?? null,
    zustand: o.zustand ?? 'N',
    ifPresent: 'aufstocken',
  });
}

module.exports = { konto, subAccount, setRecorded, PASSWORT };
