/** Erst der eigene Bestand (CSV-Tabellen, Zwischenspeicher), dann der Client:
 * Das Kontingent ist knapp. Der Client fragt nur ab, ablegen tut dieser Dienst. */
import { getRbKey, holeSet, getThemeName, holeSetTeile, holeFigurTeile } from '../../clients/rebrickable';
import { istErsatzteil } from '../infra/validate';
import { mitVersion } from '../sets/setNummer';
import { neuestesInventar } from './rbInventar';
import { meldeUndLiefere } from '../infra/fehler';
import * as repo from './repository/rebrickableCache';

/** Ein kaputter Eintrag zählt als keiner. */
function ausCache<T>(json: string | undefined): T | undefined {
  if (!json) return undefined;
  try { return JSON.parse(json) as T; } catch { return undefined; }
}

export async function getSetInfo(setNumber: string) {
  const n = mitVersion(setNumber);
  const cached = await repo.katalogSetZu(n);
  // "Set <Nummer>" ist ein Platzhalter, kein Name; als Treffer überschrieb er
  // beim nächsten Erfassen den echten Namen. Nachgefragt wird höchstens täglich.
  if (cached?.name && cached.name !== `Set ${n}`) return cached;
  if (cached?.name && cached.fetched_at && Date.now() - new Date(cached.fetched_at).getTime() < 86_400_000) return null;
  const data = await holeSet(n);
  if (!data) {
    await repo.merkeUnbekanntesSet(n, !!(await getRbKey()));
    return null;
  }
  const theme = await getThemeName(data.theme_id);
  const row = { set_number: n, name: data.name || null, year: data.year || null, theme: theme || null,
                pieces: data.num_parts || null, image_url: data.set_img_url || null, is_gear: false };
  await repo.merkeSet(row);
  return row;
}

async function setTeileAusCsv(setNumber: string) {
  const invId = await neuestesInventar(setNumber).catch(meldeUndLiefere('rebrickable:inventar', null));
  if (!invId) return null;
  const parts = await repo.inventarTeile(invId).catch(meldeUndLiefere('rebrickable:inventarteile', []));
  if (!parts.length) return null;
  return parts.map(p => ({
    part: {
      part_num:     p.part_num,
      name:         p.name || p.part_num,
      part_img_url: p.part_img_url || p.img_url || null,
      external_ids: { BrickLink: p.bl_part_num && p.bl_part_num !== p.part_num ? [p.bl_part_num] : [] },
    },
    color: { id: p.color_id, name: p.color_name || '', rgb: p.color_rgb || null },
    quantity: p.quantity,
    is_spare: istErsatzteil(p.is_spare),
  }));
}

/** Eine leere Antwort (404, Abbruch) kurz merken: Sonst kostet jeder
 * wiederholte Import einer unbekannten Nummer erneut Kontingent. */
const _leer = new Map<string, number>();
const LEER_MS = 10 * 60 * 1000;

export async function getAllSetParts(setNumber: string) {
  const csvParts = await setTeileAusCsv(setNumber);
  if (csvParts) return csvParts;
  const n = mitVersion(setNumber);
  const gemerkt = ausCache<any[]>(await repo.teilelisteAusCache(n));
  if (gemerkt) return gemerkt;
  if (Date.now() - (_leer.get(n) ?? 0) < LEER_MS) return [];
  const { teile, verweigert } = await holeSetTeile(n);
  // Eine Absage (403) wird als leere Liste gemerkt, damit nicht jeder Import erneut fragt.
  if (teile.length > 0 || verweigert) await repo.merkeTeileliste(n, JSON.stringify(teile));
  else { if (_leer.size > 5000) _leer.clear(); _leer.set(n, Date.now()); }
  return teile;
}

/** Geteilter Zwischenspeicher: Die Daten ändern sich selten, das Kontingent ist knapp. */
export async function getMinifigParts(figNumber: string) {
  const gemerkt = ausCache<any[]>(await repo.figurenteileAusCache(figNumber).catch(meldeUndLiefere('rebrickable:figurenteile', undefined)));
  if (gemerkt) return gemerkt;
  const parts = await holeFigurTeile(figNumber);
  if (!parts) return [];
  await repo.merkeFigurenteile(figNumber, JSON.stringify(parts)).catch(meldeUndLiefere('rebrickable:figurenteile-merken', undefined));
  return parts;
}
