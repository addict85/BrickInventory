import type { Schreiber } from '../haushalt';
import type { DbSchnittstelle } from '../../db/database';
import * as repo from './repository/papierkorb';
import * as kauf from './repository/kaufErfassungen';
import type { PapierArt } from './repository/papierkorb';
import type { BestandKontext } from './kontext';

export type Art = PapierArt;
export const AUFBEWAHRUNG_TAGE = 30;

const ERFASSUNGEN: Record<Art, string> = {
  set: 'set_acquisitions',
  teil: 'part_acquisitions',
  figur: 'minifig_acquisitions',
};

function parameter(art: Art, userId: number, nummer: string, farbeId: number | null) {
  return art === 'teil' ? [userId, nummer, farbeId] : [userId, nummer];
}

/** In der Transaktion des Löschens, VOR den DELETEs: Scheitert das Ablegen,
 * wird auch nicht gelöscht.
 * @returns die id des Eintrags, oder null, wenn es keine Stammzeile gab */
export async function legeInPapierkorb(
  tx: DbSchnittstelle,
  art: Art,
  userId: number,
  nummer: string,
  farbeId: number | null = null,
): Promise<number | null> {
  const p = parameter(art, userId, nummer, farbeId);
  const zeilen = await repo.bestandsZeilen(tx, art, p);
  const stamm = repo.tabellenDerArt(art)[0] ?? '';
  if (!zeilen[stamm]?.length) return null;

  const name = await repo.bezeichnung(tx, art, userId, nummer, farbeId);
  return repo.legeEintragAn(tx, userId, art, nummer, art === 'teil' ? farbeId : null, name, zeilen);
}

/** Einzelne Käufe eines Sets, die eine Mengenverringerung wegnahm: Die Bestandszeile bleibt, darum ein
 * Eintrag ohne `sets`-Zeile. Wiederherstellen legt die Mengen zurück (stelleKaeufeWiederHer).
 * @param zeilen je Kauf die ganze Zeile, `quantity` = die weggenommene Menge */
export async function legeKaeufeInPapierkorb(
  tx: DbSchnittstelle,
  userId: number,
  nummer: string,
  zeilen: Record<string, unknown>[],
): Promise<number | null> {
  if (!zeilen.length) return null;
  const name = await repo.bezeichnung(tx, 'set', userId, nummer, null);
  const leer = Object.fromEntries(repo.tabellenDerArt('set').map(t => [t, [] as unknown[]]));
  return repo.legeEintragAn(tx, userId, 'set', nummer, null, name, { ...leer, set_acquisitions: zeilen });
}

/** Zurück in die Zeile, aus der die Menge kam; gibt es sie nicht mehr, in eine gleiche Zeile desselben Tages
 * (der eindeutige Index erlaubt keine zweite), sonst als neue Zeile. Ohne Bestandszeile ging das Set
 * inzwischen ganz weg: Dann zuerst dessen Eintrag wiederherstellen. */
async function stelleKaeufeWiederHer(tx: DbSchnittstelle, e: { user_id: number; nummer: string }, kaeufe: Kauf[]) {
  if (!(await repo.hatSetZeile(tx, e.user_id, e.nummer))) return false;
  for (const k of kaeufe) {
    const menge = Number(k.quantity) || 0;
    if (await kauf.stockeErfassungAuf(tx, 'set', Number(k.id), e.user_id, menge)) continue;
    const gleich = await kauf.gleicheErfassungAmTag(tx, 'set', e.user_id, [e.nummer], String(k.tag), -1, {
      zustand: String(k.condition ?? 'N'),
      preis: k.purchase_price == null ? null : Number(k.purchase_price),
      geschaetzt: !!k.price_estimated,
      waehrung: k.currency == null ? null : String(k.currency),
    });
    if (gleich && (await kauf.stockeErfassungAuf(tx, 'set', gleich, e.user_id, menge))) continue;
    await repo.schreibeZurueck(tx, 'set_acquisitions', [k]);
  }
  return true;
}
type Kauf = Record<string, unknown>;

export interface PapierkorbEintrag {
  id: number;
  user_id: number;
  art: Art;
  nummer: string;
  farbe_id: number | null;
  bezeichnung: string | null;
  anzahl: number;
  geloescht_am: string;
  endgueltig_am: string;
}

export async function listePapierkorb(k: BestandKontext, uidsWahl: Schreiber | number[]): Promise<PapierkorbEintrag[]> {
  const uids = await k.haushalt.haushalt.schreibbereichAus(uidsWahl);
  const rows = await k.papierkorb.eintraege(uids, AUFBEWAHRUNG_TAGE);
  return rows.map(r => {
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
export async function stelleWiederHer(
  k: BestandKontext,
  uidsWahl: Schreiber | number[],
  id: number,
): Promise<Wiederherstellung> {
  const uids = await k.haushalt.haushalt.schreibbereichAus(uidsWahl);
  try {
    return await k.transaktion(async (t): Promise<Wiederherstellung> => {
      const e = await repo.eintragSperren(t.db, id, uids);
      if (!e) return { ok: false, code: 'nicht_gefunden' };
      const art = e.art as Art;
      const kaeufe = art === 'set' && !e.zeilen?.sets?.length ? (e.zeilen?.set_acquisitions ?? []) : null;
      if (kaeufe) {
        if (!(await stelleKaeufeWiederHer(t.db, e, kaeufe))) return { ok: false, code: 'nicht_gefunden' };
        await repo.entferneEintrag(t.db, id);
        return { ok: true, art, nummer: e.nummer, user_id: e.user_id };
      }
      for (const tabelle of repo.tabellenDerArt(art))
        await repo.schreibeZurueck(t.db, tabelle, e.zeilen?.[tabelle] ?? []);
      await repo.entferneEintrag(t.db, id);
      return { ok: true, art, nummer: e.nummer, user_id: e.user_id };
    });
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') return { ok: false, code: 'papierkorb_schon_vorhanden' };
    throw err;
  }
}

export async function loescheEndgueltig(
  k: BestandKontext,
  uidsWahl: Schreiber | number[],
  id: number,
): Promise<boolean> {
  const uids = await k.haushalt.haushalt.schreibbereichAus(uidsWahl);
  return (await k.papierkorb.entferneEintragDesKontos(id, uids)) > 0;
}

export async function leerePapierkorb(k: BestandKontext, uidsWahl: Schreiber | number[]): Promise<number> {
  const uids = await k.haushalt.haushalt.schreibbereichAus(uidsWahl);
  return k.papierkorb.entferneAlle(uids);
}

export async function raeumePapierkorbAuf(k: BestandKontext): Promise<number> {
  return k.papierkorb.entferneAeltere(AUFBEWAHRUNG_TAGE);
}
