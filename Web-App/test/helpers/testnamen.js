'use strict';
/**
 * Namen für Datenbanken und Rollen, die ein Test selbst anlegt. Alle beginnen
 * mit `<Basis-DB>_vorlage_`: So sind sie auf einem geteilten Server als Reste
 * dieser Suite erkennbar, und scripts/test-lauf.js räumt sie beim nächsten
 * Lauf ab, auch wenn ein Test vor seinem t.after abgebrochen ist.
 * Gegenprobe (04.11.2026): Rest-DB …_schema_basis_999999 angelegt, in
 * schema-basis-db raeumeReste() gestrichen → die DB blieb; mit dem Aufruf weg.
 */
const STANDARD = 'postgres://tester:test@localhost/cattest';

/** Die Basis-Datenbank (nicht die Kopie, die test-lauf.js je Datei anlegt). */
function basisUrl() {
  return new URL(process.env.TEST_DB_BASIS || process.env.TEST_DATABASE_URL || STANDARD);
}

/** `<basis>_vorlage` — derselbe Stamm wie die Vorlage in scripts/test-lauf.js. */
function stamm() {
  return `${decodeURIComponent(basisUrl().pathname.slice(1))}_vorlage`.toLowerCase();
}

/** Name für eine Datenbank oder Rolle dieses Prozesses: `<stamm>_<art>_<pid>`. */
function testName(art) {
  return `${stamm()}_${art}_${process.pid}`;
}

const id = s => `"${String(s).replace(/"/g, '""')}"`;
const lebt = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/**
 * Reste früherer Läufe derselben Art löschen, deren Prozess nicht mehr lebt:
 * erst Datenbanken, dann Rollen (eine Rolle mit Objekten lässt sich nicht löschen).
 */
async function raeumeReste(admin, art) {
  const muster = `${stamm()}_${art}_%`.replace(/_/g, '\\_');
  const pidAus = name => Number(name.slice(`${stamm()}_${art}_`.length).match(/^\d+/)?.[0]);
  const tot = name => {
    const pid = pidAus(name);
    return pid > 0 && pid !== process.pid && !lebt(pid);
  };
  const dbs = (await admin.query('SELECT datname AS n FROM pg_database WHERE datname LIKE $1', [muster])).rows;
  for (const { n } of dbs.filter(r => tot(r.n))) await admin.query(`DROP DATABASE IF EXISTS ${id(n)} WITH (FORCE)`);
  const rollen = (await admin.query('SELECT rolname AS n FROM pg_roles WHERE rolname LIKE $1', [muster])).rows;
  for (const { n } of rollen.filter(r => tot(r.n))) await admin.query(`DROP ROLE IF EXISTS ${id(n)}`).catch(() => {});
}

module.exports = { basisUrl, stamm, testName, raeumeReste, id };
