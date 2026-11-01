/** Nummer und PIN ver- und entschlüsselt nur dieses Repository: Schon die Nummer löst ein. */
import * as db from '../../../db/database';
import { verschluessele, entschluessele, suchwert } from '../../infra/geheimnis';

export interface GutscheinZeile {
  id: number; number: string; pin: string | null; amount: string | number; currency: string;
  pdf_path: string | null; created_at: string | Date; updated_at: string | Date;
  guthaben_geprueft_am: string | Date | null;
}
/** currency null: Die Datenbank setzt die Währung des Kontos (Trigger vouchers_waehrung). */
export interface GutscheinWerte { number: string; pin: string | null; amount: number; currency: string | null }

const SPALTEN = 'id, number, pin, amount, currency, pdf_path, created_at, updated_at, guthaben_geprueft_am';

/** Konto im HMAC: Dieselbe Karte in zwei Konten soll nicht als gleich erkennbar sein. */
export function nummerSpalten(uid: number, nummer: string): { number: string; nummer_suche: string } {
  return { number: verschluessele(nummer) as string, nummer_suche: suchwert('gutschein-nummer', `${uid}:${nummer}`) };
}

/** Falscher Schlüssel: leere Nummer, der Vertrag verlangt eine Zeichenkette. */
function lesbar(z: GutscheinZeile): GutscheinZeile {
  return { ...z, number: entschluessele(z.number) ?? '', pin: entschluessele(z.pin) };
}

export async function gutscheineDesKontos(uid: number, ordnung: 'neueste' | 'aelteste' = 'neueste'): Promise<GutscheinZeile[]> {
  const reihe = ordnung === 'neueste' ? 'created_at DESC, id DESC' : 'created_at, id';
  return (await db.all<GutscheinZeile>(`SELECT ${SPALTEN} FROM vouchers WHERE user_id = $1 ORDER BY ${reihe}`, [uid])).map(lesbar);
}

export async function gutschein(uid: number, id: number): Promise<GutscheinZeile | undefined> {
  const z = await db.get<GutscheinZeile>(`SELECT ${SPALTEN} FROM vouchers WHERE id = $1 AND user_id = $2`, [id, uid]);
  return z && lesbar(z);
}

/** undefined, wenn es die Nummer schon gibt — kein stilles Überschreiben. */
export async function gutscheinAnlegen(uid: number, w: GutscheinWerte): Promise<GutscheinZeile | undefined> {
  const n = nummerSpalten(uid, w.number);
  const z = await db.get<GutscheinZeile>(
    `INSERT INTO vouchers (user_id, number, nummer_suche, pin, amount, currency) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, nummer_suche) DO NOTHING RETURNING ${SPALTEN}`,
    [uid, n.number, n.nummer_suche, verschluessele(w.pin), w.amount, w.currency]);
  return z && lesbar(z);
}

export async function gutscheinErsetzen(uid: number, w: GutscheinWerte): Promise<boolean> {
  const n = nummerSpalten(uid, w.number);
  const r = await db.get<{ war_neu: boolean }>(
    `INSERT INTO vouchers (user_id, number, nummer_suche, pin, amount, currency) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, nummer_suche) DO UPDATE
        SET pin = COALESCE(EXCLUDED.pin, vouchers.pin), amount = EXCLUDED.amount,
            currency = EXCLUDED.currency, updated_at = NOW()
     RETURNING (xmax = 0) AS war_neu`,
    [uid, n.number, n.nummer_suche, verschluessele(w.pin), w.amount, w.currency]);
  return !!r?.war_neu;
}

export async function gutscheinAendern(uid: number, id: number, w: GutscheinWerte): Promise<GutscheinZeile | undefined> {
  const n = nummerSpalten(uid, w.number);
  const z = await db.get<GutscheinZeile>(
    `UPDATE vouchers SET number=$1, nummer_suche=$2, pin=$3, amount=$4, currency=$5, updated_at=NOW()
      WHERE id=$6 AND user_id=$7 RETURNING ${SPALTEN}`,
    [n.number, n.nummer_suche, verschluessele(w.pin), w.amount, w.currency, id, uid]);
  return z && lesbar(z);
}

export async function gutscheinPdfMerken(uid: number, id: number, relPfad: string) {
  await db.run('UPDATE vouchers SET pdf_path = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [relPfad, id, uid]);
}

/** undefined, wenn es die Zeile nicht gab. */
export async function gutscheinLoeschen(uid: number, id: number): Promise<string | null | undefined> {
  const z = await db.get<{ pdf_path: string | null }>('DELETE FROM vouchers WHERE id = $1 AND user_id = $2 RETURNING pdf_path', [id, uid]);
  return z ? z.pdf_path : undefined;
}

export async function guthabenMerken(uid: number, id: number, betrag: number, waehrung: string): Promise<GutscheinZeile | undefined> {
  const z = await db.get<GutscheinZeile>(
    `UPDATE vouchers SET amount = $1, currency = $2, guthaben_geprueft_am = NOW(), updated_at = NOW()
      WHERE id = $3 AND user_id = $4 RETURNING ${SPALTEN}`, [betrag, waehrung, id, uid]);
  return z && lesbar(z);
}

/** Klartext von vor Migration 0087; `number = $4` lässt eine inzwischen
 * geänderte Zeile stehen, ein falscher Schlüssel die Zeile, wie sie ist. */
export async function nummernNachverschluesseln(): Promise<number> {
  let n = 0;
  for (const z of await db.all<{ id: number; user_id: number; number: string }>(
    'SELECT id, user_id, number FROM vouchers WHERE nummer_suche IS NULL')) {
    const nummer = entschluessele(z.number);
    if (nummer === null) continue;
    const s = nummerSpalten(z.user_id, nummer);
    n += (await db.run('UPDATE vouchers SET number = $1, nummer_suche = $2 WHERE id = $3 AND nummer_suche IS NULL AND number = $4',
      [s.number, s.nummer_suche, z.id, z.number])).changes || 0;
  }
  return n;
}

/** Die Kopien vor einer Migration (db/migrate.ts) hielten sonst Klartext, bis
 * drei weitere sie verdrängen. Der Schemaname ist durch das Muster geprüft. */
export async function kopienVerschluesseln(): Promise<number> {
  let n = 0;
  for (const { schema } of await db.all<{ schema: string }>(
    `SELECT table_schema AS schema FROM information_schema.tables
      WHERE table_name = 'vouchers' AND table_schema ~ '^vor_migration_[0-9]+$'`)) {
    for (const z of await db.all<{ id: number; number: string; pin: string | null }>(
      `SELECT id, number, pin FROM ${schema}.vouchers WHERE number NOT LIKE 'v1:%' OR pin NOT LIKE 'v1:%'`)) {
      n += (await db.run(`UPDATE ${schema}.vouchers SET number = $1, pin = $2 WHERE id = $3`,
        [verschluessele(z.number), verschluessele(z.pin), z.id])).changes || 0;
    }
  }
  return n;
}
