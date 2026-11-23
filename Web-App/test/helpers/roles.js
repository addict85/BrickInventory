'use strict';
/**
 * The roles of a test run as in production (postgres/app-role.sh): owner
 * (migrations, test data), runtime role (app), system role (BYPASSRLS), web system role
 * (BYPASSRLS, only access tables; the system context of the HTTP requests). A
 * superuser would bypass row security; a missing system context would stay invisible.
 * The names depend on the template so that parallel runs on one server do not meet.
 */

/** @param {string} template */
function roles(template) {
  // The kind is part of the role name in existing test databases ('eigen'), so it stays.
  /** @param {string} kind */
  const r = kind => ({ name: `${template}_rolle_${kind}`, password: `test-${template}-${kind}` });
  return { own: r('eigen'), app: r('app'), system: r('system'), systemweb: r('systemweb'), read: r('read') };
}

/** The same address with another role. @param {string} url @param {{ name: string, password: string }} role */
function asRole(url, role) {
  const u = new URL(url);
  u.username = encodeURIComponent(role.name);
  u.password = encodeURIComponent(role.password);
  return u.toString();
}

/** Does the file still run as superuser? The marker stands in the head of the test file
 * (ratchet in test/roles-separation-db.test.js). @param {string} source */
const asSuperuser = source => /^\s*(\*|\/\/)\s*@superuser\b/m.test(source);
/** Does the file call services in the system context (helpers/system-frame.js)? @param {string} source */
const inSystemFrame = source => /^require\('\.\/helpers\/systemrahmen'\);/m.test(source);

module.exports = { roles, asRole, asSuperuser, inSystemFrame };
