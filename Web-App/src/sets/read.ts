import { forSet, mergeInstructions } from '../catalog';
import { resolveImageLocal } from '../images';
import { reportError } from '../infra/error';
import * as repo from './repository/sets';
import { asIds, type Sicht, type ScopeInput as Blickfeld } from '../household';
import { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions } from '../inventory';

// Read queries; condition from the acquisitions.

import type { Abfrage } from '../contract';
import { versuche } from '../infra/result';
import type { SetsContext } from './context';

/** Filtering and sorting on the server, so that they work together with page-wise
 * loading. Without page_size everything — that is how the Android app calls. */
export async function setsLesen(
  sk: SetsContext,
  userIdChoice: Sicht | Blickfeld,
  query: Abfrage<'GET /api/v1/sets'> = {},
) {
  const userId = await sk.household.scopeFrom(userIdChoice);
  // asIds(), so that older callers with a bare ID keep working.
  const uids = asIds(userId);
  // The column list is in the repository; the response only carries what the
  // clients read.
  const { search, theme, sort, page = 1, page_size = null } = query;
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const { sets, countRow, themeRows } = await repo.setList(sk.db, uids, {
    search,
    theme,
    sort,
    storage: query.storage,
    seite: size ? { groesse: size, versatz: (Math.max(1, parseInt(String(page), 10) || 1) - 1) * size } : null,
    themen: !!page_size && parseInt(String(page), 10) <= 1,
  });

  // Instructions only for the sets of THIS page; without sets both queries are dropped.
  const pageSetNumbers = sets.map(r => r.set_number);
  const [sharedInstrs, userInstrs] = pageSetNumbers.length
    ? await Promise.all([
        repo.sharedInstructions(sk.db, pageSetNumbers, uids),
        repo.ownInstructions(sk.db, uids, pageSetNumbers),
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
    // One used acquisition makes the set used (conditionFromAcquisitions).
    condition: conditionFromAcquisitions(s.acq_count, s.used_count),
    conditions: conditionsFromAcquisitions(s.acq_count, s.used_count),
    avg_purchase_price: s.avg_purchase_price != null ? parseFloat(s.avg_purchase_price) : null,
    image_local: resolveImageLocal(s.image_local),
    // Owners only in the household — in a single account "belongs to me" would only be noise.
    // Always there, even empty: array_agg returns NULL if the FILTER excludes everything.
    ...(uids.length > 1 ? { owner_ids: (s.owner_ids || []).map(n => parseInt(String(n), 10)) } : {}),
    instructions: mergeInstructions(sharedBySet.get(s.set_number) || [], userBySet.get(s.set_number) || []),
  }));

  // One query for the whole page instead of one per row.
  const withOwners = await sk.household.besitzerAnhaengen(uids, mapped);

  // With a total count for infinite scroll; without pagination total is the length.
  return {
    sets: withOwners,
    total: countRow ? countRow.c : mapped.length,
    ...(themeRows ? { themes: themeRows.map(r => r.theme) } : {}),
  };
}

// One used acquisition makes the set used; the rule lives only here.
export async function zustandsAggregat(sk: SetsContext, userId: Blickfeld, setNumber: string) {
  const uids = asIds(userId);
  const acq = await repo.setEntryMetrics(sk.db, uids, setNumber);
  const acqCount = Number(acq?.acq_count) || 0;
  const usedCount = Number(acq?.used_count) || 0;
  return {
    condition: conditionFromAcquisitions(acqCount, usedCount),
    // The same fields as setsLesen(sk): the tile is updated after saving without
    // reloading and would otherwise lose the second badge.
    conditions: conditionsFromAcquisitions(acqCount, usedCount),
    acq_count: acqCount,
    used_count: usedCount,
    max_purchase_price: acq?.max_purchase_price ?? null,
    avg_purchase_price: acq?.avg_purchase_price != null ? parseFloat(acq.avg_purchase_price) : null,
  };
}

/** So that the write endpoints update the tile without reloading. */
export async function withSetAggregate<T extends object>(
  sk: SetsContext,
  userId: Blickfeld,
  setNumber: string,
  payload: T,
) {
  const uids = asIds(userId);
  const agg = await versuche('sets-handler:zustandsAggregat', zustandsAggregat(sk, uids, setNumber));
  return agg.ok ? { ...payload, set: { set_number: setNumber, ...agg.wert } } : payload;
}

export async function readSet(sk: SetsContext, userIdChoice: Sicht | Blickfeld, setNumber: string) {
  const userId = await sk.household.scopeFrom(userIdChoice);
  const uids = asIds(userId);
  const [set, shared, uploaded] = await Promise.all([
    // The own row wins for condition and purchase price; the QUANTITY is the sum
    // over the scope.
    repo.setDetailRow(sk.db, uids, setNumber, uids[0]),
    sk.catalog.instructionsToSet(setNumber),
    repo.ownInstructionsOfSets(sk.db, uids, setNumber),
  ]);
  if (!set) return null;
  // The same fields as setsLesen(sk), so that a client can overwrite the tile with the
  // detail.
  const agg = await zustandsAggregat(sk, uids, setNumber);
  // The purchase addresses from the server: one address in four places would be four truths.
  const [bricklink, preisvergleich] = await Promise.all([
    sk.catalog.resolveBlLink(setNumber).catch((e: unknown) => {
      reportError('setdetail:bricklink', e);
      return null;
    }),
    Promise.resolve(forSet(setNumber, set.name)),
  ]);
  const { owner_ids, ...withoutIds } = set;
  const [withOwners] = await sk.household.besitzerAnhaengen(uids, [
    uids.length > 1 ? { ...withoutIds, owner_ids } : withoutIds,
  ]);
  return {
    ...withOwners,
    ...agg,
    bricklink,
    preisvergleich_url: preisvergleich,
    image_local: resolveImageLocal(set.image_local),
    instructions: mergeInstructions(shared, uploaded),
  };
}
