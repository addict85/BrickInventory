/**
 * Papierkorb: Wer ein Set, ein manuelles Teil oder eine manuelle Figur
 * löscht, kann es 30 Tage lang zurückholen.
 */
import type { DbSchnittstelle } from '../../db/database';
import * as db from '../../db/database';
import * as repo from './repository/papierkorb';
import type { PapierArt } from './repository/papierkorb';

export type Art = PapierArt;
export const AUFBEWAHRUNG_TAGE = 30;

/** Die Menge eines Eintrags ist die Summe seiner gesicherten Erfassungen. */
const ERFASSUNGEN: Record<Art, string> = {
  set: 'set_acquisitions', teil: 'part_acquisitions', figur: 'minifig_acquisitions',
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
  const zeilen = await repo.bestandsZeilen(tx, art, p);
  const stamm = repo.tabellenDerArt(art)[0] ?? '';
  if (!zeilen[stamm]?.length) return null;

  const name = await repo.bezeichnung(tx, art, nummer, farbeId);
  return repo.legeEintragAn(tx, userId, art, nummer, art === 'teil' ? farbeId : null, name, zeilen);
}

export interface PapierkorbEintrag {
  id: number; user_id: number; art: Art; nummer: string; farbe_id: number | null;
  bezeichnung: string | null; anzahl: number; geloescht_am: string; endgueltig_am: string;
}

/** Die Einträge der Konten, die der Aufrufer schreiben darf — neueste zuerst. */
export async function listePapierkorb(uids: number[]): Promise<PapierkorbEintrag[]> {
  const rows = await repo.eintraege(uids, AUFBEWAHRUNG_TAGE);
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
      const e = await repo.eintragSperren(tx, id, uids);
      if (!e) return { ok: false, code: 'nicht_gefunden' };
      const art = e.art as Art;
      for (const tabelle of repo.tabellenDerArt(art))
        await repo.schreibeZurueck(tx, tabelle, e.zeilen?.[tabelle] ?? []);
      await repo.entferneEintrag(tx, id);
      return { ok: true, art, nummer: e.nummer, user_id: e.user_id };
    });
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') return { ok: false, code: 'papierkorb_schon_vorhanden' };
    throw err;
  }
}

/** Einen Eintrag endgültig entfernen. @returns ob es ihn gab */
export async function loescheEndgueltig(uids: number[], id: number): Promise<boolean> {
  return await repo.entferneEintragDesKontos(id, uids) > 0;
}

/** Den Papierkorb der Konten leeren. @returns Zahl der entfernten Einträge */
export async function leerePapierkorb(uids: number[]): Promise<number> {
  return repo.entferneAlle(uids);
}

/** Einträge nach Ablauf der Frist entfernen (stündlich, Auftrag 'aufraeumen'). */
export async function raeumePapierkorbAuf(): Promise<number> {
  return repo.entferneAeltere(AUFBEWAHRUNG_TAGE);
}
