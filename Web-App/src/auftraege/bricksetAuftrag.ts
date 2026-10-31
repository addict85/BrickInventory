import * as db from '../../db/database';
import { notify } from '../../db/pgNotify';
import { AUFTRAG_KANAL, beendePause, zieheVor } from './auftraege';
import { naechsteUhrzeit, taeglicheUhrzeit } from './zeitplan';

/**
 * Die Brickset-Wiedervorlage als Aufträge der Art 'brickset' — einer je Set,
 * fällig zur eingestellten Uhrzeit (job_time_brickset_retry). `versuch` in der
 * Nutzlast zählt die Wiedervorlagen über Aufträge hinweg: Nach 30 Tagen ohne
 * Kontingent gibt Brickset für dieses Set auf (clients/brickset.ts).
 */
export const BRICKSET_HOECHSTENS = 30;
const schluessel = (sn: string) => `brickset:${sn}`;

/** Wann ein vorgemerktes Set wieder dran ist: bald (Störung der Gegenseite) oder zur Tageszeit. */
export async function bricksetFaelligAb(bald: boolean): Promise<Date> {
  if (bald) return new Date(Date.now() + 30 * 60_000);
  return naechsteUhrzeit(await taeglicheUhrzeit('brickset_retry'));
}

/**
 * Ein Set (wieder) vormerken. @returns false, wenn es schon BRICKSET_HOECHSTENS
 * Mal vorgemerkt war — dann ist es aus der Wiedervorlage genommen.
 */
export async function bricksetVormerken(sn: string, fehler: string, bald = false): Promise<{ versuch: number; vorgemerkt: boolean }> {
  const z = await db.get<{ v: number }>(
    `SELECT COALESCE(MAX((nutzlast->>'versuch')::int), 0) AS v FROM auftraege
      WHERE schluessel = $1 AND status IN ('offen', 'laeuft')`, [schluessel(sn)]);
  const versuch = (z?.v ?? 0) + 1;
  if (versuch > BRICKSET_HOECHSTENS) { await bricksetAusWiedervorlage(sn); return { versuch, vorgemerkt: false }; }
  await db.run(
    `INSERT INTO auftraege (art, nutzlast, schluessel, max_versuche, faellig_ab, fehler)
     VALUES ('brickset', $2, $1, 3, $3, $4)
     ON CONFLICT (schluessel) WHERE status = 'offen'
       DO UPDATE SET nutzlast = EXCLUDED.nutzlast, faellig_ab = EXCLUDED.faellig_ab,
                     fehler = EXCLUDED.fehler, aktualisiert = NOW()`,
    [schluessel(sn), JSON.stringify({ set_number: sn, versuch }), await bricksetFaelligAb(bald), fehler]);
  await notify(AUFTRAG_KANAL, 'brickset');
  return { versuch, vorgemerkt: true };
}

/** Aus der Wiedervorlage nehmen (Erfolg, endgültiger Fehler, Verwaltung). */
export async function bricksetAusWiedervorlage(sn: string): Promise<void> {
  await db.run(`DELETE FROM auftraege WHERE schluessel = $1 AND status = 'offen'`, [schluessel(sn)]);
}

/** Jetzt abarbeiten — ein Set oder alle (nach einem höheren Kontingent). */
export async function bricksetJetzt(sn?: string): Promise<void> {
  await beendePause('brickset');
  await zieheVor('brickset', sn ? schluessel(sn) : undefined);
}

/** Die Wiedervorlage für die Verwaltung, im Format der früheren Tabelle. */
export function bricksetListe(): Promise<any[]> {
  return db.all(
    `SELECT a.nutzlast->>'set_number' AS set_number, to_char(a.faellig_ab, 'YYYY-MM-DD') AS retry_after,
            COALESCE((a.nutzlast->>'versuch')::int, 1) AS attempts, a.fehler AS last_error,
            a.erstellt AS created_at, c.name
       FROM auftraege a LEFT JOIN set_catalog c ON c.set_number = a.nutzlast->>'set_number'
      WHERE a.art = 'brickset' AND a.status IN ('offen', 'laeuft')
      ORDER BY a.faellig_ab, 1`);
}

/** Wartende und davon heute fällige Einträge. */
export async function bricksetZahlen(): Promise<{ wartend: number; faellig: number }> {
  const z = await db.get<{ wartend: number; faellig: number }>(
    `SELECT COUNT(*)::int AS wartend, COUNT(*) FILTER (WHERE faellig_ab <= NOW())::int AS faellig
       FROM auftraege WHERE art = 'brickset' AND status IN ('offen', 'laeuft')`);
  return { wartend: z?.wartend ?? 0, faellig: z?.faellig ?? 0 };
}
