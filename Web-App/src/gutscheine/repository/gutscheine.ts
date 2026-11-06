/** Nummer und PIN ver- und entschlüsselt nur dieses Repository: Schon die Nummer löst ein. */
import * as db from '../../../db/database';
import { verschluessele, entschluessele, suchwert, kontext, umschluesseln, altwertLesen } from '../../infra/geheimnis';

export interface GutscheinZeile {
  id: number; number: string; pin: string | null; amount: string | number; currency: string;
  pdf_path: string | null; created_at: string | Date; updated_at: string | Date;
  guthaben_geprueft_am: string | Date | null;
}
/** currency null: Die Datenbank setzt die Währung des Kontos (Trigger vouchers_waehrung). */
export interface GutscheinWerte { number: string; pin: string | null; amount: number; currency: string | null }

const SPALTEN = 'id, number, pin, amount, currency, pdf_path, created_at, updated_at, guthaben_geprueft_am';

/** Konto und Zeile im Kontext: Nummer oder PIN, in einen anderen Gutschein kopiert, bleiben unlesbar. */
export const nummerKontext = (uid: number, id: number) => kontext('vouchers.number', uid, id);
export const pinKontext = (uid: number, id: number) => kontext('vouchers.pin', uid, id);
export const nummerSuche = (uid: number, nummer: string) => suchwert('gutschein-nummer', `${uid}:${nummer}`);

/** Konto im HMAC: Dieselbe Karte in zwei Konten soll nicht als gleich erkennbar sein. */
export function nummerSpalten(uid: number, id: number, nummer: string): { number: string; nummer_suche: string } {
  return { number: verschluessele(nummer, nummerKontext(uid, id)) as string, nummer_suche: nummerSuche(uid, nummer) };
}

/** Falscher Schlüssel: leere Nummer, der Vertrag verlangt eine Zeichenkette. */
function lesbar(uid: number, z: GutscheinZeile): GutscheinZeile {
  return { ...z, number: entschluessele(z.number, nummerKontext(uid, z.id)) ?? '', pin: entschluessele(z.pin, pinKontext(uid, z.id)) };
}

/** Die ID vor dem INSERT: Sie steht im Kontext der Verschlüsselung. */
async function neueId(): Promise<number> {
  return (await db.get<{ id: number }>("SELECT nextval(pg_get_serial_sequence('vouchers', 'id'))::int AS id"))!.id;
}

export async function gutscheineDesKontos(uid: number, ordnung: 'neueste' | 'aelteste' = 'neueste'): Promise<GutscheinZeile[]> {
  const reihe = ordnung === 'neueste' ? 'created_at DESC, id DESC' : 'created_at, id';
  return (await db.all<GutscheinZeile>(`SELECT ${SPALTEN} FROM vouchers WHERE user_id = $1 ORDER BY ${reihe}`, [uid])).map(z => lesbar(uid, z));
}

export async function gutschein(uid: number, id: number): Promise<GutscheinZeile | undefined> {
  const z = await db.get<GutscheinZeile>(`SELECT ${SPALTEN} FROM vouchers WHERE id = $1 AND user_id = $2`, [id, uid]);
  return z && lesbar(uid, z);
}

/** undefined, wenn es die Nummer schon gibt — kein stilles Überschreiben. */
export async function gutscheinAnlegen(uid: number, w: GutscheinWerte): Promise<GutscheinZeile | undefined> {
  const id = await neueId();
  const n = nummerSpalten(uid, id, w.number);
  const z = await db.get<GutscheinZeile>(
    `INSERT INTO vouchers (id, user_id, number, nummer_suche, pin, amount, currency) VALUES ($7,$1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, nummer_suche) DO NOTHING RETURNING ${SPALTEN}`,
    [uid, n.number, n.nummer_suche, verschluessele(w.pin, pinKontext(uid, id)), w.amount, w.currency, id]);
  return z && lesbar(uid, z);
}

/** Erst die vorhandene Zeile suchen: Die PIN braucht deren ID im Kontext.
 * @returns ob der Gutschein neu angelegt wurde */
export async function gutscheinErsetzen(uid: number, w: GutscheinWerte): Promise<boolean> {
  for (let versuch = 0; versuch < 3; versuch++) {
    const da = await db.get<{ id: number }>('SELECT id FROM vouchers WHERE user_id = $1 AND nummer_suche = $2', [uid, nummerSuche(uid, w.number)]);
    if (!da) { if (await gutscheinAnlegen(uid, w)) return true; continue; }
    const r = await db.run(`UPDATE vouchers SET pin = COALESCE($1, pin), amount = $2, currency = $3, updated_at = NOW()
      WHERE id = $4 AND user_id = $5`, [verschluessele(w.pin, pinKontext(uid, da.id)), w.amount, w.currency, da.id, uid]);
    if (r.changes) return false;
  }
  throw new Error('Gutschein ändert sich gleichzeitig an anderer Stelle');
}

export async function gutscheinAendern(uid: number, id: number, w: GutscheinWerte): Promise<GutscheinZeile | undefined> {
  const n = nummerSpalten(uid, id, w.number);
  const z = await db.get<GutscheinZeile>(
    `UPDATE vouchers SET number=$1, nummer_suche=$2, pin=$3, amount=$4, currency=$5, updated_at=NOW()
      WHERE id=$6 AND user_id=$7 RETURNING ${SPALTEN}`,
    [n.number, n.nummer_suche, verschluessele(w.pin, pinKontext(uid, id)), w.amount, w.currency, id, uid]);
  return z && lesbar(uid, z);
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
  return z && lesbar(uid, z);
}

/** Klartext (vor 0087) und v1 auf v2, vor der ersten Anfrage. `AND number = $…` lässt
 * eine inzwischen geänderte Zeile stehen, ein falscher Schlüssel die Zeile, wie sie ist. */
export async function nummernNachverschluesseln(): Promise<number> {
  let n = 0;
  for (const z of await db.all<{ id: number; user_id: number; number: string; pin: string | null; nummer_suche: string | null }>(
    "SELECT id, user_id, number, pin, nummer_suche FROM vouchers WHERE number NOT LIKE 'v2:%' OR pin NOT LIKE 'v2:%' OR nummer_suche IS NULL")) {
    const nummer = altwertLesen(z.number, nummerKontext(z.user_id, z.id));
    if (nummer === null) continue;
    const neu = z.number.startsWith('v2:') ? z.number : nummerSpalten(z.user_id, z.id, nummer).number;
    const pin = umschluesseln(z.pin, pinKontext(z.user_id, z.id)) ?? z.pin;
    n += (await db.run(`UPDATE vouchers SET number = $1, nummer_suche = $2, pin = $3
      WHERE id = $4 AND number = $5 AND pin IS NOT DISTINCT FROM $6`,
      [neu, nummerSuche(z.user_id, nummer), pin, z.id, z.number, z.pin])).changes || 0;
  }
  return n;
}

/** Nach einem Schlüsselwechsel, samt Suchwert (er hängt am Schlüssel). Dieselbe
 * Bedingung wie oben lässt eine inzwischen geänderte Zeile stehen. */
export async function gutscheineNeuVerschluesseln(): Promise<number> {
  let n = 0;
  for (const z of await db.all<{ id: number; user_id: number; number: string; pin: string | null; nummer_suche: string | null }>(
    "SELECT id, user_id, number, pin, nummer_suche FROM vouchers WHERE number LIKE 'v2:%'")) {
    const nummer = entschluessele(z.number, nummerKontext(z.user_id, z.id));
    if (nummer === null) continue;
    const neu = umschluesseln(z.number, nummerKontext(z.user_id, z.id)) ?? z.number;
    const pin = umschluesseln(z.pin, pinKontext(z.user_id, z.id)) ?? z.pin;
    const suche = nummerSuche(z.user_id, nummer);
    if (neu === z.number && pin === z.pin && suche === z.nummer_suche) continue;
    n += (await db.run(`UPDATE vouchers SET number = $1, nummer_suche = $2, pin = $3
      WHERE id = $4 AND number = $5 AND pin IS NOT DISTINCT FROM $6`, [neu, suche, pin, z.id, z.number, z.pin])).changes || 0;
  }
  return n;
}

/** Kopien vor einer Migration (Schemaname durch das Muster geprüft); `alle` nach einem Schlüsselwechsel. */
export async function kopienVerschluesseln(alle = false): Promise<number> {
  let n = 0;
  for (const { schema } of await db.all<{ schema: string }>(
    `SELECT table_schema AS schema FROM information_schema.tables
      WHERE table_name = 'vouchers' AND table_schema ~ '^vor_migration_[0-9]+$'`)) {
    for (const z of await db.all<{ id: number; user_id: number; number: string; pin: string | null }>(
      `SELECT id, user_id, number, pin FROM ${schema}.vouchers${alle ? '' : " WHERE number NOT LIKE 'v2:%' OR pin NOT LIKE 'v2:%'"}`)) {
      const nummer = umschluesseln(z.number, nummerKontext(z.user_id, z.id));
      const pin = umschluesseln(z.pin, pinKontext(z.user_id, z.id));
      if (nummer === undefined && pin === undefined) continue;
      n += (await db.run(`UPDATE ${schema}.vouchers SET number = $1, pin = $2 WHERE id = $3`,
        [nummer ?? z.number, pin ?? z.pin, z.id])).changes || 0;
    }
  }
  return n;
}
