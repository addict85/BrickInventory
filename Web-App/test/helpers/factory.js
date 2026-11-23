'use strict';
/**
 * Test data via the services of this test file (testServices()) instead of raw SQL: account,
 * household and entry are created the way the server creates them (log, household rules,
 * entry including stock row). If the schema changes, the factory follows the service.
 * Only after buildAndRequire(); in the system context (helpers/system-frame.js) like every test preparation.
 */
const { testServices } = require('./sources');

const PASSWORD = 'Fabrik-Passwort-2026';

/** An account via konto.createAccount (without administrator: the log names none).
 * @param {string} name @param {{ admin?: boolean }} [o] @returns {Promise<number>} */
async function account(name, o = {}) {
  const id = await testServices().account.addAccount(null, name, PASSWORD, !!o.admin);
  if (id === null) throw new Error(`Account „${name}“ already exists`);
  return id;
}

/** Attaches `sub` to `main` as in the UI: create the invitation and redeem it.
 * @param {number} main @param {number} sub */
async function subAccount(main, sub) {
  const h = testServices().household;
  const e = await h.createInvitation(main);
  if (!e.code) throw new Error(`Invitation rejected: ${e.error}`);
  const r = await h.redeemInvitation(sub, e.code);
  if (r?.error) throw new Error(`Redeeming rejected: ${r.error}`);
}

/** A set with one entry via sets.acquireSet, booked at the account `owner`.
 * @param {number} owner @param {string} setNumber
 * @param {{ quantity?: number, price?: number | null, condition?: 'N' | 'U' }} [o] */
async function setRecorded(owner, setNumber, o = {}) {
  return testServices().sets.acquireSet({
    requester: owner,
    ownerWish: owner,
    setNumber,
    quantity: o.quantity ?? 1,
    purchasePrice: o.price ?? null,
    condition: o.condition ?? 'N',
    ifPresent: 'aufstocken',
  });
}

module.exports = { konto: account, subAccount, setRecorded, PASSWORD };
