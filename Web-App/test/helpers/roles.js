'use strict';
/**
 * The roles of a test run as in production (postgres/app-role.sh): owner
 * (migrations, test data), runtime role (app), system role (BYPASSRLS), web system role
 * (BYPASSRLS, only access tables; the system context of the HTTP requests). A
 * superuser would bypass row security; a missing system context would stay invisible.
 * The names depend on the template so that parallel runs on one server do not meet.
 */

/** @param {string} vorlage */
function rollen(vorlage) {
  /** @param {string} kind */
  const r = kind => ({ name: `${vorlage}_rolle_${kind}`, passwort: `test-${vorlage}-${kind}` });
  return { eigen: r('eigen'), app: r('app'), system: r('system'), systemweb: r('systemweb'), lesen: r('read') };
}

/** The same address with another role. @param {string} url @param {{ name: string, passwort: string }} rolle */
function asRole(url, rolle) {
  const u = new URL(url);
  u.username = encodeURIComponent(rolle.name);
  u.password = encodeURIComponent(rolle.passwort);
  return u.toString();
}

/** Does the file still run as superuser? The marker stands in the head of the test file
 * (ratchet in test/roles-separation-db.test.js). @param {string} source */
const asSuperuser = source => /^\s*(\*|\/\/)\s*@superuser\b/m.test(source);
/** Does the file call services in the system context (helpers/system-frame.js)? @param {string} source */
const inSystemFrame = source => /^require\('\.\/helpers\/systemrahmen'\);/m.test(source);

module.exports = { rollen, asRole, asSuperuser, inSystemFrame };
