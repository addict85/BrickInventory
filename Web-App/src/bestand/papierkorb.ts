/**
 * Papierkorb: Wer ein Set, ein manuelles Teil oder eine manuelle Figur
 * löscht, kann es 30 Tage lang zurückholen.
 *
 * Abgelegt wird ein JSON-Schnappschuss aller Zeilen, die das Löschen
 * entfernt (Migration 0041). Wiederhergestellt wird über die Spalten, die es
 * HEUTE gibt — so übersteht ein Eintrag auch eine spätere Spaltenänderung.
 */
import type { DbSchnittstelle } from '../../db/database';
import * as db from '../../db/database';

export type Art = 'set' | 'teil' | 'figur';
export const AUFBEWAHRUNG_TAGE = 30;

/**
 * Welche Zeilen zu einem Eintrag gehören — dieselben Bedingungen wie in
 * deleteSetRows() bzw. loescheManuellesTeil()/loescheManuelleFigur().
 * Die erste Tabelle ist die Stammzeile: Ist sie leer, gibt es nichts zu löschen.
 */
const TABELLEN: Record<Art, { tabelle: string; wo: string }[]> = {
  set: [
    { tabelle: 'sets',             wo: 'user_id = $1 AND set_number = $2' },
    { tabelle: 'parts',            wo: 'user_id = $1 AND set_number = $2' },
    { tabelle: 'minifigs',         wo: 'user_id = $1 AND set_number = $2' },
    { tabelle: 'set_acquisitions', wo: 'user_id = $1 AND set_number = $2' },
  ],
  teil: [
    { tabelle: 'parts',             wo: "user_id = $1 AND part_number = $2 AND color_id = $3 AND source = 'manual'" },
    { tabelle: 'part_acquisitions', wo: 'user_id = $1 AND part_number = $2 AND color_id = $3' },
  ],
  figur: [
    { tabelle: 'minifigs',             wo: "user_id = $1 AND fig_number = $2 AND source = 'manual'" },
    { tabelle: 'minifig_acquisitions', wo: 'user_id = $1 AND fig_number = $2' },
  ],
};

const ERFASSUNGEN: Record<Art, string> = {
  set: 'set_acquisitions', teil: 'part_acquisitions', figur: 'minifig_acquisitions',
};

const BEZEICHNUNG: Record<Art, string> = {
  set:   'SELECT name AS b FROM set_catalog WHERE set_number = $1',
  teil:  `SELECT concat_ws(' · ', pc.part_name, pcc.color_name) AS b
            FROM part_catalog pc
            LEFT JOIN part_color_catalog pcc ON pcc.part_number = pc.part_number AND pcc.color_id = $2
           WHERE pc.part_number = $1`,
  figur: 'SELECT fig_name AS b FROM minifigs_catalog WHERE fig_number = $1',
};

function parameter(art: Art, userId: number, nummer: string, farbeId: number | null) {
  return art === 'teil' ? [userId, nummer, farbeId] : [userId, nummer];
}

/**
 * Den Schnappschuss ablegen. Läuft in der Transaktion des Löschens, VOR den
 * DELETEs — scheitert das Ablegen, wird auch nicht gelöscht.
 *
 * @returns die id des Eintrags, oder null, wenn es keine Stammzeile gab
 */
export async function legeInPapierkorb(
  tx: DbSchnittstelle, art: Art, userId: number, nummer: string, farbeId: number | null = null,
): Promise<number | null> {
  const p = parameter(art, userId, nummer, farbeId);
  const zeilen: Record<string, unknown[]> = {};
  for (const { tabelle, wo } of TABELLEN[art]) {
    const r = await tx.get(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS z FROM ${tabelle} t WHERE ${wo}`, p);
    zeilen[tabelle] = r?.z ?? [];
  }
  const stamm = TABELLEN[art][0]?.tabelle ?? '';
  if (!zeilen[stamm]?.length) return null;

  const name = await tx.get(BEZEICHNUNG[art], art === 'teil' ? [nummer, farbeId] : [nummer]);
  const r = await tx.get(
    `INSERT INTO papierkorb (user_id, art, nummer, farbe_id, bezeichnung, zeilen)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [userId, art, nummer, art === 'teil' ? farbeId : null, name?.b || null, JSON.stringify(zeilen)]);
  return r?.id ?? null;
}

export interface PapierkorbEintrag {
  id: number; user_id: number; art: Art; nummer: string; farbe_id: number | null;
  bezeichnung: string | null; anzahl: number; geloescht_am: string; endgueltig_am: string;
}

/** Die Einträge der Konten, die der Aufrufer schreiben darf — neueste zuerst. */
export async function listePapierkorb(uids: number[]): Promise<PapierkorbEintrag[]> {
  const rows = await db.all(
    `SELECT id, user_id, art, nummer, farbe_id, bezeichnung, zeilen, geloescht_am,
            geloescht_am + make_interval(days => $2) AS endgueltig_am
       FROM papierkorb WHERE user_id = ANY($1)
      ORDER BY geloescht_am DESC, id DESC LIMIT 500`, [uids, AUFBEWAHRUNG_TAGE]);
  return rows.map((r: PapierkorbEintrag & { zeilen?: Record<string, { quantity?: unknown }[]> }) => {
    const erfassungen = r.zeilen?.[ERFASSUNGEN[r.art]] ?? [];
    const { zeilen: _z, ...rest } = r;
    return { ...rest, anzahl: erfassungen.reduce((s, e) => s + (Number(e.quantity) || 0), 0) };
  });
}

export type Wiederherstellung =
  | { ok: true; art: Art; nummer: string; user_id: number }
  | { ok: false; code: 'nicht_gefunden' | 'papierkorb_schon_vorhanden' };

/**
 * Einen Eintrag zurückspielen und aus dem Papierkorb nehmen.
 *
 * Gibt es das Element inzwischen wieder (neu angelegt), greift ein
 * eindeutiger Index — dann wird nichts verändert und der Eintrag bleibt.
 */
export async function stelleWiederHer(uids: number[], id: number): Promise<Wiederherstellung> {
  try {
    return await db.transaction(async (tx): Promise<Wiederherstellung> => {
      const e = await tx.get(
        'SELECT * FROM papierkorb WHERE id = $1 AND user_id = ANY($2) FOR UPDATE', [id, uids]);
      if (!e) return { ok: false, code: 'nicht_gefunden' };
      const art = e.art as Art;
      for (const { tabelle } of TABELLEN[art]) {
        const zeilen: Record<string, unknown>[] = e.zeilen?.[tabelle] ?? [];
        const erste = zeilen[0];
        if (!erste) continue;
        const spalten = (await tx.all(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = $1
              AND is_generated = 'NEVER'`, [tabelle]))
          .map((s: { column_name: string }) => s.column_name)
          .filter((s: string) => s in erste);
        const liste = spalten.map((s: string) => `"${s}"`).join(', ');
        await tx.run(
          `INSERT INTO ${tabelle} (${liste})
           SELECT ${liste} FROM jsonb_populate_recordset(NULL::${tabelle}, $1::jsonb)`,
          [JSON.stringify(zeilen)]);
      }
      await tx.run('DELETE FROM papierkorb WHERE id = $1', [id]);
      return { ok: true, art, nummer: e.nummer, user_id: e.user_id };
    });
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') return { ok: false, code: 'papierkorb_schon_vorhanden' };
    throw err;
  }
}

/** Einen Eintrag endgültig entfernen. @returns ob es ihn gab */
export async function loescheEndgueltig(uids: number[], id: number): Promise<boolean> {
  const r = await db.run('DELETE FROM papierkorb WHERE id = $1 AND user_id = ANY($2)', [id, uids]);
  return (r.changes ?? 0) > 0;
}

/** Den Papierkorb der Konten leeren. @returns Zahl der entfernten Einträge */
export async function leerePapierkorb(uids: number[]): Promise<number> {
  const r = await db.run('DELETE FROM papierkorb WHERE user_id = ANY($1)', [uids]);
  return r.changes ?? 0;
}

/** Einträge nach Ablauf der Frist entfernen (stündlich, Auftrag 'aufraeumen'). */
export async function raeumePapierkorbAuf(): Promise<number> {
  const r = await db.run(
    'DELETE FROM papierkorb WHERE geloescht_am < NOW() - make_interval(days => $1)', [AUFBEWAHRUNG_TAGE]);
  return r.changes ?? 0;
}
