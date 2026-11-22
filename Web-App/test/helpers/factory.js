'use strict';
/**
 * Test data via the services of this test file (testServices()) instead of raw SQL: account,
 * household and entry are created the way the server creates them (log, household rules,
 * entry including stock row). If the schema changes, the factory follows the service.
 * Only after buildAndRequire(); in the system context (helpers/system-frame.js) like every test preparation.
 */
const { testServices } = require('./sources');

const PASSWORT = 'Fabrik-Passwort-2026';

/** An account via konto.createAccount (without administrator: the log names none).
 * @param {string} name @param {{ verwalter?: boolean }} [o] @returns {Promise<number>} */
async function konto(name, o = {}) {
  const id = await testServices().account.addAccount(null, name, PASSWORT, !!o.verwalter);
  if (id === null) throw new Error(`Konto „${name}“ gibt es schon`);
  return id;
}

/** Attaches `unter` to `haupt` as in the UI: create the invitation and redeem it.
 * @param {number} haupt @param {number} unter */
async function subAccount(haupt, unter) {
  const h = testServices().household;
  const e = await h.createInvitation(haupt);
  if (!e.code) throw new Error(`Einladung abgewiesen: ${e.error}`);
  const r = await h.redeemInvitation(unter, e.code);
  if (r?.error) throw new Error(`Einlösen abgewiesen: ${r.error}`);
}

/** A set with one entry via sets.acquireSet, booked at the account `besitzer`.
 * @param {number} besitzer @param {string} setNumber
 * @param {{ quantity?: number, preis?: number | null, condition?: 'N' | 'U' }} [o] */
async function setRecorded(besitzer, setNumber, o = {}) {
  return testServices().sets.acquireSet({
    requester: besitzer,
    ownerWish: besitzer,
    setNumber,
    quantity: o.quantity ?? 1,
    kaufpreis: o.preis ?? null,
    condition: o.condition ?? 'N',
    ifPresent: 'aufstocken',
  });
}

module.exports = { konto, subAccount, setRecorded, PASSWORT };
