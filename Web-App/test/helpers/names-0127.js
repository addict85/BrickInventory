/**
 * Probes that replay an old migration need the object names of that time:
 * 0127 renamed constraints, indexes and triggers. These helpers take the
 * renames from the migration itself and run them backwards or forwards.
 */
const fs = require('node:fs');
const path = require('node:path');

const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'db/migrations/0127-schema-english-phase2.sql'), 'utf8');

/** [statement with the old name, statement with the new name] per renamed object. */
const RENAMES = [
  ...SQL.matchAll(/^ALTER TABLE (\S+) RENAME CONSTRAINT (\S+) TO (\S+);$/gm),
  ...SQL.matchAll(/^ALTER INDEX ()(\S+) RENAME TO (\S+);$/gm),
  ...SQL.matchAll(/^ALTER TRIGGER (\S+) ON (\S+) RENAME TO (\S+);$/gm),
].map(m => {
  if (m[0].startsWith('ALTER TABLE')) {
    const [, t, alt, neu] = m;
    return [
      `ALTER TABLE ${t} RENAME CONSTRAINT ${neu} TO ${alt}`,
      `ALTER TABLE ${t} RENAME CONSTRAINT ${alt} TO ${neu}`,
    ];
  }
  if (m[0].startsWith('ALTER INDEX')) {
    const [, , alt, neu] = m;
    return [`ALTER INDEX ${neu} RENAME TO ${alt}`, `ALTER INDEX ${alt} RENAME TO ${neu}`];
  }
  const [, alt, t, neu] = m;
  return [`ALTER TRIGGER ${neu} ON ${t} RENAME TO ${alt}`, `ALTER TRIGGER ${alt} ON ${t} RENAME TO ${neu}`];
});

// Objects a probe dropped beforehand, or the old migration dropped, are skipped.
async function each(c, statements) {
  for (const sql of statements) {
    await c.query('SAVEPOINT n0127');
    try {
      await c.query(sql);
      await c.query('RELEASE SAVEPOINT n0127');
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT n0127');
    }
  }
}

/** Back to the names before 0127 (inside a transaction that is rolled back). */
const before0127 = c =>
  each(
    c,
    RENAMES.map(([back]) => back),
  );

/** Forward again, after the old migration ran. */
const after0127 = c =>
  each(
    c,
    RENAMES.map(([, forward]) => forward),
  );

module.exports = { before0127, after0127, RENAMES };
