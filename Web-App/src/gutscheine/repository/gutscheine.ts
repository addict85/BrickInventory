/**
 * Fachdienst Gutscheine: Datenzugriff auf vouchers, je Konto. Die PIN liegt
 * verschlüsselt in der Tabelle; hier wird sie beim Lesen entschlüsselt und
 * beim Schreiben verschlüsselt, damit keine Route mit dem Klartext rechnet.
 */
import * as db from '../../../db/database';
import { verschluessele, entschluessele } from '../../infra/geheimnis';

export interface GutscheinZeile {
  id: number; number: string; pin: string | null; amount: string | number; currency: string;
  pdf_path: string | null; created_at: string | Date; updated_at: string | Date;
  /** Wann das Guthaben zuletzt bei LEGO abgefragt wurde, oder NULL. */
  guthaben_geprueft_am: string | Date | null;
}
/** currency null: Die Datenbank setzt die Währung des Kontos (Trigger vouchers_waehrung). */
export interface GutscheinWerte { number: string; pin: string | null; amount: number; currency: string | null }

const SPALTEN = 'id, number, pin, amount, currency, pdf_path, created_at, updated_at, guthaben_geprueft_am';

/** Die PIN im Klartext — nur für die Antwort und die Guthabenabfrage. */
function mitKlarerPin(z: GutscheinZeile): GutscheinZeile { return { ...z, pin: entschluessele(z.pin) }; }

export async function gutscheineDesKontos(uid: number, ordnung: 'neueste' | 'aelteste' = 'neueste'): Promise<GutscheinZeile[]> {
  const reihe = ordnung === 'neueste' ? 'created_at DESC, id DESC' : 'created_at, id';
  return (await db.all<GutscheinZeile>(`SELECT ${SPALTEN} FROM vouchers WHERE user_id = $1 ORDER BY ${reihe}`, [uid])).map(mitKlarerPin);
}

export async function gutschein(uid: number, id: number): Promise<GutscheinZeile | undefined> {
  const z = await db.get<GutscheinZeile>(`SELECT ${SPALTEN} FROM vouchers WHERE id = $1 AND user_id = $2`, [id, uid]);
  return z && mitKlarerPin(z);
}

/** Legt an; gibt es die Nummer im Konto schon, undefined (kein stilles Überschreiben). */
export async function gutscheinAnlegen(uid: number, w: GutscheinWerte): Promise<GutscheinZeile | undefined> {
  const z = await db.get<GutscheinZeile>(
    `INSERT INTO vouchers (user_id, number, pin, amount, currency) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, number) DO NOTHING RETURNING ${SPALTEN}`,
    [uid, w.number, verschluessele(w.pin), w.amount, w.currency]);
  return z && mitKlarerPin(z);
}

/** Anlegen oder ersetzen (Stapel aus einem PDF): true, wenn die Nummer neu war. */
export async function gutscheinErsetzen(uid: number, w: GutscheinWerte): Promise<boolean> {
  const r = await db.get<{ war_neu: boolean }>(
    `INSERT INTO vouchers (user_id, number, pin, amount, currency) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, number) DO UPDATE
        SET pin = COALESCE(EXCLUDED.pin, vouchers.pin), amount = EXCLUDED.amount,
            currency = EXCLUDED.currency, updated_at = NOW()
     RETURNING (xmax = 0) AS war_neu`,
    [uid, w.number, verschluessele(w.pin), w.amount, w.currency]);
  return !!r?.war_neu;
}

export async function gutscheinAendern(uid: number, id: number, w: GutscheinWerte): Promise<GutscheinZeile | undefined> {
  const z = await db.get<GutscheinZeile>(
    `UPDATE vouchers SET number=$1, pin=$2, amount=$3, currency=$4, updated_at=NOW()
      WHERE id=$5 AND user_id=$6 RETURNING ${SPALTEN}`,
    [w.number, verschluessele(w.pin), w.amount, w.currency, id, uid]);
  return z && mitKlarerPin(z);
}

export async function gutscheinPdfMerken(uid: number, id: number, relPfad: string) {
  await db.run('UPDATE vouchers SET pdf_path = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [relPfad, id, uid]);
}

/** Löscht die Zeile; gibt ihren PDF-Pfad zurück (oder null), undefined wenn es sie nicht gab. */
export async function gutscheinLoeschen(uid: number, id: number): Promise<string | null | undefined> {
  const z = await db.get<{ pdf_path: string | null }>('DELETE FROM vouchers WHERE id = $1 AND user_id = $2 RETURNING pdf_path', [id, uid]);
  return z ? z.pdf_path : undefined;
}

export async function guthabenMerken(uid: number, id: number, betrag: number, waehrung: string): Promise<GutscheinZeile | undefined> {
  const z = await db.get<GutscheinZeile>(
    `UPDATE vouchers SET amount = $1, currency = $2, guthaben_geprueft_am = NOW(), updated_at = NOW()
      WHERE id = $3 AND user_id = $4 RETURNING ${SPALTEN}`, [betrag, waehrung, id, uid]);
  return z && mitKlarerPin(z);
}
