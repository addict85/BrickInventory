import { resolveImageLocal } from '../katalog/bilder/images';
import { asIds } from '../haushalt/haushalt';
import { clampPageSize, applyManualCondition, withOwners, conditionFromAcquisitions, conditionsFromAcquisitions } from '../bestand/gemeinsam';
import { mitVersion } from '../sets/setNummer';
import { marktpreiseAusCacheFuerFiguren } from '../finanzen/marketPrice';
import * as repo from './repository/figurenListe';

/**
 * Leseabfragen für Minifiguren.
 * Ausführlich: docs/begruendungen/src/figuren/abfragen.ts.md#abschnitt
 */

/**
 * Filter lagen hier schon serverseitig; ergänzt sind nur page/page_size.
 * Ohne page_size unverändertes Verhalten — die Android-App ruft so auf.
 */
export async function getMinifigs(userId: number | number[], { search, source, set_number, page = 1, page_size = null }: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const { figCount, figs } = await repo.figurenGruppiert(uids, { search, source,
    setNumber: set_number ? mitVersion(set_number) : null,
    seite: size ? { groesse: size, versatz: (Math.max(1, parseInt(page) || 1) - 1) * size } : null });

  // Angezeigter Zustand als Aggregat über die Kaufpreis-Erfassungen manueller
  // Figuren: eine "Gebraucht"-Erfassung genügt, damit die Figur als gebraucht
  // gilt. Figuren aus Sets haben keine Erfassungen → gespeicherter Wert.
  const usedFigRows = await repo.zustandszahlenManuellerFiguren(uids);
  const zustandJeFigur = new Map<string, { acq_count: number; used_count: number }>(
    usedFigRows.map(r => [r.fkey, r] as [string, { acq_count: number; used_count: number }]));

  const zustand = (f: { fig_number: unknown }) => zustandJeFigur.get(String(f.fig_number).trim().toLowerCase());
  const mappedFigs = figs.map(({ owner_ids, ...f }: any) => ({
    ...f,
    // owner_ids nur im Haushalt (wie bei Sets); im Einzelkonto wäre „gehört
    // mir“ an jeder Kachel Rauschen, deshalb oben abgetrennt.
    ...(uids.length > 1 ? { owner_ids: (owner_ids || []).map((n: any) => parseInt(n)) } : {}),
    image_local: resolveImageLocal(f.image_local),
    // Ohne Erfassung 'N' — nicht mehr der gespeicherte Wert, den es seit
    // Migration 0035 nicht mehr gibt. Fuer Set-Figuren dasselbe Ergebnis wie
    // vorher: Dort stand die Spalte seit jeher auf dem Vorgabewert.
    condition: conditionFromAcquisitions(zustand(f)?.acq_count, zustand(f)?.used_count),
    // Alle erfassten Zustände — die Kachel zeigt je einen (wie bei Sets).
    conditions: conditionsFromAcquisitions(zustand(f)?.acq_count, zustand(f)?.used_count),
  }));

  // Objektform wie bei getSets, damit die Gesamtzahl für den Endlos-Scroll
  // mitkommt. Ohne Paginierung entspricht total der Listenlänge.
  return {
    figs: await withOwners(uids, mappedFigs),
    total: figCount ? parseInt(figCount.c) : mappedFigs.length,
  };
}

/**
 * Kennzahlen des Minifiguren-Reiters: Arten, Gesamtstückzahl, manuell erfasste.
 * Ausführlich: docs/begruendungen/src/figuren/abfragen.ts.md#getminifigstats
 * @param userId Blickfeld (scopeIds) oder eine einzelne ID
 */
export async function getMinifigStats(userId: number | number[]) {
  const uids = asIds(userId as any);
  const row = await repo.figurenKennzahlen(uids);
  return {
    types: row?.types ?? 0,
    total_quantity: row?.total_quantity ?? 0,
    manual: row?.manual ?? 0,
    // Alter Name der Webapp-Antwort — dieselbe Zahl, damit die Kachel nicht
    // von der Umbenennung abhängt.
    unique_figs: row?.types ?? 0,
  };
}

/**
 * Manuell erfasste Minifiguren.
 * @param viewerId wessen Einstellungen gelten (Währung); `userId` sagt, wessen Daten.
 */
export async function getManualMinifigs(userId: number | number[], viewerId: number,
                                 { page = 1, page_size = null, search = null }: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const figs = await repo.manuelleFigurenListe(uids, search,
    size ? { groesse: size, versatz: (Math.max(1, parseInt(page) || 1) - 1) * size } : null);
  const mapped = figs.map(f => ({ ...f, image_local: resolveImageLocal(f.image_local) }));
  const mitZustand = await applyManualCondition(uids, mapped, 'fig');

  // Der Marktpreis gehoert dazu
  // NUR aus dem Cache, in EINER Abfrage fuer die ganze Liste: Ein Live-Abruf
  // je Eintrag waere genau der Zustand, von dem der Umzug weg von der
  // Bewertung wegfuehren sollte. Siehe src/finanzen/marketPrice.ts.
  // Ausführlich: docs/begruendungen/src/figuren/abfragen.ts.md#getmanualminifigs-preise
  const preise = await marktpreiseAusCacheFuerFiguren(mitZustand, viewerId)
    .catch(() => new Map<string, number>());
  const mitPreis = mitZustand.map((f: any) =>
    ({ ...f, avg_price: preise.get(String(f.fig_number)) ?? null }));

  return withOwners(uids, mitPreis);
}

