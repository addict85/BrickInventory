import { resolveImageLocal } from '../katalog/bilder/images';
import { asIds } from '../haushalt/haushalt';
import { clampPageSize, applyManualCondition, withOwners, conditionFromAcquisitions, conditionsFromAcquisitions } from '../bestand/gemeinsam';
import { mitVersion } from '../sets/setNummer';
import { marktpreiseAusCacheFuerFiguren } from '../finanzen/marketPrice';
import * as repo from './repository/figurenListe';

// Ausführlich: docs/begruendungen/src/figuren/abfragen.ts.md#abschnitt

/** Ohne page_size unverändertes Verhalten — die Android-App ruft so auf. */
export async function getMinifigs(userId: number | number[], { search, source, set_number, page = 1, page_size = null }: any = {}) {
  // asIds(), damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const { figCount, figs } = await repo.figurenGruppiert(uids, { search, source,
    setNumber: set_number ? mitVersion(set_number) : null,
    seite: size ? { groesse: size, versatz: (Math.max(1, parseInt(page) || 1) - 1) * size } : null });

  // Eine „Gebraucht"-Erfassung genügt, damit die Figur als gebraucht gilt.
  const usedFigRows = await repo.zustandszahlenManuellerFiguren(uids);
  const zustandJeFigur = new Map<string, { acq_count: number; used_count: number }>(
    usedFigRows.map(r => [r.fkey, r] as [string, { acq_count: number; used_count: number }]));

  const zustand = (f: { fig_number: unknown }) => zustandJeFigur.get(String(f.fig_number).trim().toLowerCase());
  const mappedFigs = figs.map(({ owner_ids, ...f }: any) => ({
    ...f,
    // owner_ids nur im Haushalt: Im Einzelkonto wäre „gehört mir" Rauschen.
    ...(uids.length > 1 ? { owner_ids: (owner_ids || []).map((n: any) => parseInt(n)) } : {}),
    image_local: resolveImageLocal(f.image_local),
    // Ohne Erfassung 'N'.
    condition: conditionFromAcquisitions(zustand(f)?.acq_count, zustand(f)?.used_count),
    conditions: conditionsFromAcquisitions(zustand(f)?.acq_count, zustand(f)?.used_count),
  }));

  // Mit Gesamtzahl für den Endlos-Scroll, wie bei getSets.
  return {
    figs: await withOwners(uids, mappedFigs),
    total: figCount ? parseInt(figCount.c) : mappedFigs.length,
  };
}

// Ausführlich: docs/begruendungen/src/figuren/abfragen.ts.md#getminifigstats
export async function getMinifigStats(userId: number | number[]) {
  const uids = asIds(userId as any);
  const row = await repo.figurenKennzahlen(uids);
  return {
    types: row?.types ?? 0,
    total_quantity: row?.total_quantity ?? 0,
    manual: row?.manual ?? 0,
    // Alter Name der Webapp-Antwort, damit die Kachel nicht von der Umbenennung abhängt.
    unique_figs: row?.types ?? 0,
  };
}

/** @param viewerId wessen Einstellungen gelten (Währung); `userId` sagt, wessen Daten. */
export async function getManualMinifigs(userId: number | number[], viewerId: number,
                                 { page = 1, page_size = null, search = null }: any = {}) {
  const uids = asIds(userId as any);
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const figs = await repo.manuelleFigurenListe(uids, search,
    size ? { groesse: size, versatz: (Math.max(1, parseInt(page) || 1) - 1) * size } : null);
  const mapped = figs.map(f => ({ ...f, image_local: resolveImageLocal(f.image_local) }));
  const mitZustand = await applyManualCondition(uids, mapped, 'fig');

  // Der Marktpreis NUR aus dem Cache, in einer Abfrage für die ganze Liste:
  // Ein Live-Abruf je Eintrag liesse die Liste auf BrickLink warten.
  // Ausführlich: docs/begruendungen/src/figuren/abfragen.ts.md#getmanualminifigs-preise
  const preise = await marktpreiseAusCacheFuerFiguren(mitZustand, viewerId)
    .catch(() => new Map<string, number>());
  const mitPreis = mitZustand.map((f: any) =>
    ({ ...f, avg_price: preise.get(String(f.fig_number)) ?? null }));

  return withOwners(uids, mitPreis);
}

