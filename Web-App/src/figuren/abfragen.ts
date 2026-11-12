import { resolveImageLocal } from '../katalog';
import { haushaltBereich, asIds, type Sicht } from '../haushalt';
import { clampPageSize, applyManualCondition, conditionFromAcquisitions, conditionsFromAcquisitions } from '../bestand';
import { mitVersion } from '../infra/setNummer';
import { Abstriche } from '../infra/ergebnis';
import { marktpreiseAusCacheFuerFiguren } from '../finanzen';
import { figurenBereich } from './prozess';

// Leseabfragen für Minifiguren.

/** Ohne page_size unverändertes Verhalten — die Android-App ruft so auf. */
type FigurenWunsch = {
  search?: string | undefined;
  source?: string | undefined;
  set_number?: string | undefined;
  page?: number | undefined;
  page_size?: number | null | undefined;
};
export async function getMinifigs(
  userIdWahl: Sicht | number | number[],
  { search, source, set_number, page = 1, page_size = null }: FigurenWunsch = {},
) {
  const userId = await haushaltBereich().haushalt.blickfeldAus(userIdWahl);
  // asIds(), damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const { figCount, figs } = await figurenBereich().figurenListe.figurenGruppiert(uids, {
    search: search ?? null,
    source: source ?? null,
    setNumber: set_number ? mitVersion(set_number) : null,
    seite: size ? { groesse: size, versatz: (Math.max(1, page || 1) - 1) * size } : null,
  });

  // Eine „Gebraucht"-Erfassung genügt, damit die Figur als gebraucht gilt.
  const usedFigRows = await figurenBereich().figurenListe.zustandszahlenManuellerFiguren(uids);
  const zustandJeFigur = new Map<string, { acq_count: number; used_count: number }>(
    usedFigRows.map(r => [r.fkey, r] as [string, { acq_count: number; used_count: number }]),
  );

  const zustand = (f: { fig_number: unknown }) => zustandJeFigur.get(String(f.fig_number).trim().toLowerCase());
  const mappedFigs = figs.map(({ owner_ids, ...f }) => ({
    ...f,
    // owner_ids nur im Haushalt: Im Einzelkonto wäre „gehört mir" Rauschen.
    ...(uids.length > 1 ? { owner_ids: (owner_ids || []).map((n: unknown) => parseInt(String(n), 10)) } : {}),
    image_local: resolveImageLocal(f.image_local),
    // Ohne Erfassung 'N'.
    condition: conditionFromAcquisitions(zustand(f)?.acq_count, zustand(f)?.used_count),
    conditions: conditionsFromAcquisitions(zustand(f)?.acq_count, zustand(f)?.used_count),
  }));

  // Mit Gesamtzahl für den Endlos-Scroll, wie bei getSets.
  return {
    figs: await haushaltBereich().haushalt.besitzerAnhaengen(uids, mappedFigs),
    total: figCount ? figCount.c : mappedFigs.length,
  };
}

// Eine Zählung für Webapp und App; die App zählte vorher selbst und anders.
export async function getMinifigStats(userIdWahl: Sicht | number | number[]) {
  const userId = await haushaltBereich().haushalt.blickfeldAus(userIdWahl);
  const uids = asIds(userId);
  const row = await figurenBereich().figurenListe.figurenKennzahlen(uids);
  return {
    types: row?.types ?? 0,
    total_quantity: row?.total_quantity ?? 0,
    manual: row?.manual ?? 0,
    // Alter Name der Webapp-Antwort, damit die Kachel nicht von der Umbenennung abhängt.
    unique_figs: row?.types ?? 0,
  };
}

/** @param viewerId wessen Einstellungen gelten (Währung); `userId` sagt, wessen Daten. */
export async function getManualMinifigs(
  userIdWahl: Sicht | number | number[],
  viewerId: number,
  {
    page = 1,
    page_size = null,
    search = null,
  }: { page?: number; page_size?: number | null; search?: string | null } = {},
  ab = new Abstriche(),
) {
  const userId = await haushaltBereich().haushalt.blickfeldAus(userIdWahl);
  const uids = asIds(userId);
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const figs = await figurenBereich().figurenListe.manuelleFigurenListe(
    uids,
    search,
    size ? { groesse: size, versatz: (Math.max(1, page || 1) - 1) * size } : null,
  );
  const mapped = figs.map(f => ({ ...f, image_local: resolveImageLocal(f.image_local) }));
  const mitZustand = await applyManualCondition(uids, mapped, 'fig');

  // Der Marktpreis NUR aus dem Cache, in einer Abfrage für die ganze Liste:
  // Ein Live-Abruf je Eintrag liesse die Liste auf BrickLink warten.
  const preise = await ab.oder(
    'marktpreise',
    marktpreiseAusCacheFuerFiguren(mitZustand, viewerId),
    new Map<string, number>(),
  );
  const mitPreis = mitZustand.map(f => ({ ...f, avg_price: preise.get(String(f.fig_number)) ?? null }));

  return haushaltBereich().haushalt.besitzerAnhaengen(uids, mitPreis);
}
