import { resolveOne } from '../katalog/bricklinkLink';
import { meldeFehler, meldeUndLiefere } from '../infra/fehler';
import { fuerSet } from '../katalog/preisvergleich';
import * as repo from './repository/sets';
import { resolveImageLocal } from '../katalog/bilder/images';
import { asIds, withOwners, blickfeldAus, type Sicht } from '../haushalt/haushalt';
import { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions } from '../bestand/gemeinsam';
import { anleitungenZuSet, anleitungenZusammenlegen } from '../katalog/instructions';

// Leseabfragen; Zustand aus den Erfassungen. Ausführlich: docs/begruendungen/src/sets/lesen.ts.md#set-sorts


import type { BlickfeldEingabe as Blickfeld } from '../haushalt/haushalt';
import type { Abfrage } from '../vertrag';

/** Filtern und Sortieren auf dem Server, damit sie mit seitenweisem Laden
 * zusammengehen. Ohne page_size alles — so ruft die Android-App. */
export async function getSets(userIdWahl: Sicht | Blickfeld, query: Abfrage<'GET /api/v1/sets'> = {}) {
  const userId = await blickfeldAus(userIdWahl);
  // asIds(), damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Die Spaltenliste steht im Repository; die Antwort trägt nur, was die
  // Clients lesen. Ausführlich: docs/begruendungen/src/sets/lesen.ts.md#getsets-set-cols
  const { search, theme, sort, page = 1, page_size = null } = query;
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const { sets, countRow, themeRows } = await repo.setListe(uids, {
    search, theme, sort, storage: query.storage,
    seite: size ? { groesse: size, versatz: (Math.max(1, parseInt(String(page)) || 1) - 1) * size } : null,
    themen: !!page_size && parseInt(String(page)) <= 1,
  });

  // Anleitungen nur für die Sets DIESER Seite; ohne Sets entfallen beide Abfragen.
  const pageSetNumbers = sets.map((r: any) => r.set_number);
  const [sharedInstrs, userInstrs] = pageSetNumbers.length
    ? await Promise.all([
        repo.geteilteAnleitungen(pageSetNumbers, uids),
        repo.eigeneAnleitungen(uids, pageSetNumbers),
      ])
    : [[], []];

  const sharedBySet = new Map();
  for (const i of sharedInstrs) {
    if (!sharedBySet.has(i.set_number)) sharedBySet.set(i.set_number, []);
    sharedBySet.get(i.set_number).push(i);
  }
  const userBySet = new Map();
  for (const i of userInstrs) {
    if (!userBySet.has(i.set_number)) userBySet.set(i.set_number, []);
    userBySet.get(i.set_number).push(i);
  }
  const mapped = sets.map(s => ({
    ...s,
    // Eine gebrauchte Erfassung macht das Set gebraucht (conditionFromAcquisitions).
    condition: conditionFromAcquisitions(s.acq_count, s.used_count),
    conditions: conditionsFromAcquisitions(s.acq_count, s.used_count),
    avg_purchase_price: s.avg_purchase_price != null ? parseFloat(s.avg_purchase_price) : null,
    image_local: resolveImageLocal(s.image_local),
    // Besitzer nur im Haushalt — im Einzelkonto wäre „gehört mir" nur Rauschen.
    // Dort immer, auch leer: array_agg liefert NULL, wenn der FILTER alles ausschliesst.
    ...(uids.length > 1 ? { owner_ids: (s.owner_ids || []).map((n: any) => parseInt(n)) } : {}),
    instructions: anleitungenZusammenlegen(
      sharedBySet.get(s.set_number) || [],
      userBySet.get(s.set_number) || [],
    ),
  }));

  // Eine Abfrage für die ganze Seite statt einer je Zeile.
  const mitBesitzern = await withOwners(uids, mapped);

  // Mit Gesamtzahl für den Endlos-Scroll; ohne Paginierung ist total die Länge.
  return {
    sets: mitBesitzern,
    total: countRow ? countRow.c : mapped.length,
    ...(themeRows ? { themes: themeRows.map(r => r.theme) } : {}),
  };
}

// Eine gebrauchte Erfassung macht das Set gebraucht; die Regel steht nur hier.
// Ausführlich: docs/begruendungen/src/sets/lesen.ts.md#getsetconditionaggregate
export async function getSetConditionAggregate(userId: Blickfeld, setNumber: string) {
  const uids = asIds(userId);
  const acq = await repo.setErfassungsKennzahlen(uids, setNumber);
  const acqCount  = Number(acq?.acq_count) || 0;
  const usedCount = Number(acq?.used_count) || 0;
  return {
    condition: conditionFromAcquisitions(acqCount, usedCount),
    // Dieselben Felder wie getSets(): Die Kachel wird nach dem Speichern ohne
    // Neuladen aktualisiert und verlöre sonst die zweite Plakette.
    conditions: conditionsFromAcquisitions(acqCount, usedCount),
    acq_count: acqCount,
    used_count: usedCount,
    max_purchase_price: acq?.max_purchase_price ?? null,
    avg_purchase_price: acq?.avg_purchase_price != null ? parseFloat(acq.avg_purchase_price) : null,
  };
}

/** Damit die Schreib-Endpunkte die Kachel ohne Neuladen aktualisieren.
 * Ausführlich: docs/begruendungen/src/sets/lesen.ts.md#withsetaggregate */
export async function withSetAggregate<T extends object>(userId: Blickfeld, setNumber: string, payload: T) {
  const uids = asIds(userId);
  const agg = await getSetConditionAggregate(uids, setNumber).catch(meldeUndLiefere('sets-handler:getSetConditionAggregate', null));
  return agg ? { ...payload, set: { set_number: setNumber, ...agg } } : payload;
}

export async function getSet(userIdWahl: Sicht | Blickfeld, setNumber: string) {
  const userId = await blickfeldAus(userIdWahl);
  const uids = asIds(userId);
  const [set, shared, uploaded] = await Promise.all([
    // Die eigene Zeile gewinnt für Zustand und Kaufpreis; die MENGE ist die Summe
    // über das Blickfeld. Ausführlich: docs/begruendungen/src/sets/lesen.ts.md#getset
    repo.setDetailZeile(uids, setNumber, uids[0]),
    anleitungenZuSet(setNumber),
    repo.eigeneAnleitungenDesSets(uids, setNumber),
  ]);
  if (!set) return null;
  // Dieselben Felder wie getSets(), damit ein Client die Kachel mit dem Detail
  // überschreiben kann.
  const agg = await getSetConditionAggregate(uids, setNumber);
  // Die Kaufadressen vom Server: Eine Adresse an vier Stellen wären vier Wahrheiten.
  const [bricklink, preisvergleich] = await Promise.all([
    resolveOne(setNumber).catch((e: unknown) => {
      meldeFehler('setdetail:bricklink', e);
      return null;
    }),
    Promise.resolve(fuerSet(setNumber, set.name)),
  ]);
  const { owner_ids, ...ohneIds } = set;
  const [mitBesitzern] = await withOwners(uids, [uids.length > 1 ? { ...ohneIds, owner_ids } : ohneIds]);
  return { ...mitBesitzern, ...agg,
    bricklink,
    preisvergleich_url: preisvergleich,
    image_local: resolveImageLocal(set.image_local),
    instructions: anleitungenZusammenlegen(shared, uploaded) };
}
