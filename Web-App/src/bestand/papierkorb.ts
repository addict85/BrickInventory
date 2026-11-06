import { schreibbereichAus } from '../haushalt/haushalt';
import type { Schreiber } from '../haushalt/haushalt';
import type { DbSchnittstelle } from '../../db/database';
import * as db from '../../db/database';
import * as repo from './repository/papierkorb';
import type { PapierArt } from './repository/papierkorb';

export type Art = PapierArt;
export const AUFBEWAHRUNG_TAGE = 30;

const ERFASSUNGEN: Record<Art, string> = {
  set: 'set_acquisitions', teil: 'part_acquisitions', figur: 'minifig_acquisitions',
};

function parameter(art: Art, userId: number, nummer: string, farbeId: number | null) {
  return art === 'teil' ? [userId, nummer, farbeId] : [userId, nummer];
}

/** In der Transaktion des Löschens, VOR den DELETEs: Scheitert das Ablegen,
 * wird auch nicht gelöscht.
 * @returns die id des Eintrags, oder null, wenn es keine Stammzeile gab */
export async function legeInPapierkorb(
  tx: DbSchnittstelle, art: Art, userId: number, nummer: string, farbeId: number | null = null,
): Promise<number | null> {
  const p = parameter(art, userId, nummer, farbeId);
  const zeilen = await repo.bestandsZeilen(tx, art, p);
  const stamm = repo.tabellenDerArt(art)[0] ?? '';
  if (!zeilen[stamm]?.length) return null;

  const name = await repo.bezeichnung(tx, art, userId, nummer, farbeId);
  return repo.legeEintragAn(tx, userId, art, nummer, art === 'teil' ? farbeId : null, name, zeilen);
}

export interface PapierkorbEintrag {
  id: number; user_id: number; art: Art; nummer: string; farbe_id: number | null;
  bezeichnung: string | null; anzahl: number; geloescht_am: string; endgueltig_am: string;
}

export async function listePapierkorb(uidsWahl: Schreiber | number[]): Promise<PapierkorbEintrag[]> {
  const uids = await schreibbereichAus(uidsWahl);
  const rows = await repo.eintraege(uids, AUFBEWAHRUNG_TAGE);
  return rows.map((r) => {
    const erfassungen = r.zeilen?.[ERFASSUNGEN[r.art]] ?? [];
    const { zeilen: _z, ...rest } = r;
    return { ...rest, anzahl: erfassungen.reduce((s, e) => s + (Number(e.quantity) || 0), 0) };
  });
}

export type Wiederherstellung =
  | { ok: true; art: Art; nummer: string; user_id: number }
  | { ok: false; code: 'nicht_gefunden' | 'papierkorb_schon_vorhanden' };

/** Gibt es das Element inzwischen wieder, greift ein eindeutiger Index — dann
 * wird nichts verändert und der Eintrag bleibt. */
export async function stelleWiederHer(uidsWahl: Schreiber | number[], id: number): Promise<Wiederherstellung> {
  const uids = await schreibbereichAus(uidsWahl);
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

export async function loescheEndgueltig(uidsWahl: Schreiber | number[], id: number): Promise<boolean> {
  const uids = await schreibbereichAus(uidsWahl);
  return await repo.entferneEintragDesKontos(id, uids) > 0;
}

export async function leerePapierkorb(uidsWahl: Schreiber | number[]): Promise<number> {
  const uids = await schreibbereichAus(uidsWahl);
  return repo.entferneAlle(uids);
}

export async function raeumePapierkorbAuf(): Promise<number> {
  return repo.entferneAeltere(AUFBEWAHRUNG_TAGE);
}
