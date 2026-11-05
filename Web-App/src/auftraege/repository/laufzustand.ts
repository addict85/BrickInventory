import * as db from '../../../db/database';

/** Getrennt von den Einstellungen, damit Export, Sicherung und Einstellungen
 * keine Zwischenstände von Jobs zeigen. */
export async function liesZustand(schluessel: string): Promise<string | null> {
  const z = await db.get<{ wert: unknown }>('SELECT wert FROM laufzustand WHERE schluessel = $1', [schluessel]);
  return z ? String(z.wert) : null;
}

export async function setzeZustand(schluessel: string, wert: unknown): Promise<void> {
  await db.run(
    `INSERT INTO laufzustand (schluessel, wert, aktualisiert) VALUES ($1, $2, NOW())
     ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert, aktualisiert = NOW()`,
    [schluessel, String(wert)]);
}

export async function loescheZustand(...schluessel: string[]): Promise<void> {
  if (schluessel.length) await db.run('DELETE FROM laufzustand WHERE schluessel = ANY($1)', [schluessel]);
}

/** Atomar, nie unter 0: Die Zeilensperre serialisiert gleichzeitige Aufrufe. */
export async function zaehleZustand(schluessel: string, delta: number): Promise<void> {
  await db.run(
    `INSERT INTO laufzustand (schluessel, wert, aktualisiert) VALUES ($1, $2, NOW())
     ON CONFLICT (schluessel) DO UPDATE
       SET wert = GREATEST(0, COALESCE(NULLIF(laufzustand.wert, '')::int, 0) + $3)::text, aktualisiert = NOW()`,
    [schluessel, String(Math.max(0, delta)), delta]);
}

export async function zustaendeMitPraefix(praefix: string): Promise<Array<{ schluessel: string; wert: string }>> {
  return db.all('SELECT schluessel, wert FROM laufzustand WHERE starts_with(schluessel, $1)', [praefix]);
}
