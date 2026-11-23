'use strict';
/**
 * Names for databases and roles a test creates itself. All begin
 * with `<base DB>_vorlage_`: so on a shared server they are recognizable as leftovers
 * of this suite, and scripts/test-run.js clears them on the next
 * run, even if a test aborted before its t.after.
 * Counter-check (04.11.2026): leftover DB …_schema_basis_999999 created, in
 * schema-basis-db cleanRemainder() deleted → the DB stayed; with the call gone.
 */
const STANDARD = 'postgres://tester:test@localhost/cattest';

/** The base database (not the copy test-run.js creates per file). */
function baseUrl() {
  return new URL(process.env.TEST_DB_BASIS || process.env.TEST_DATABASE_URL || STANDARD);
}

/** `<basis>_vorlage` — the same stem as the template in scripts/test-run.js. */
function stem() {
  return `${decodeURIComponent(baseUrl().pathname.slice(1))}_vorlage`.toLowerCase();
}

/** Name for a database or role of this process: `<stamm>_<art>_<pid>`. */
function testName(kind) {
  return `${stem()}_${kind}_${process.pid}`;
}

const id = s => `"${String(s).replace(/"/g, '""')}"`;
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/**
 * Delete leftovers of earlier runs of the same kind whose process no longer lives:
 * first databases, then roles (a role with objects cannot be deleted).
 */
async function cleanRemainder(admin, kind) {
  const pattern = `${stem()}_${kind}_%`.replace(/_/g, '\\_');
  const pidFrom = name => Number(name.slice(`${stem()}_${kind}_`.length).match(/^\d+/)?.[0]);
  const tot = name => {
    const pid = pidFrom(name);
    return pid > 0 && pid !== process.pid && !alive(pid);
  };
  const dbs = (await admin.query('SELECT datname AS n FROM pg_database WHERE datname LIKE $1', [pattern])).rows;
  for (const { n } of dbs.filter(r => tot(r.n))) await admin.query(`DROP DATABASE IF EXISTS ${id(n)} WITH (FORCE)`);
  const roles = (await admin.query('SELECT rolname AS n FROM pg_roles WHERE rolname LIKE $1', [pattern])).rows;
  for (const { n } of roles.filter(r => tot(r.n))) await admin.query(`DROP ROLE IF EXISTS ${id(n)}`).catch(() => {});
}

module.exports = { baseUrl, stem, testName, cleanRemainder, id };
