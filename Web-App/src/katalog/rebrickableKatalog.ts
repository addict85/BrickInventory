/** Erst der eigene Bestand (CSV-Tabellen, Zwischenspeicher), dann der Client:
 * Das Kontingent ist knapp. Der Client fragt nur ab, ablegen tut dieser Dienst. */
import type { holeSetTeile, holeFigurTeile } from './quellen';
import { quellen } from './fremdquellen';
import { istErsatzteil } from '../infra/validate';
import { mitVersion } from '../infra/setNummer';
import { neuestesInventar } from './rbInventar';

import { versuche } from '../infra/ergebnis';
import type { KatalogKontext } from './kontext';

/** Ein kaputter Eintrag zählt als keiner. */
function ausCache<T>(json: string | undefined): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

export async function getSetInfo(k: KatalogKontext, setNumber: string) {
  const n = mitVersion(setNumber);
  const cached = await k.rebrickableCache.katalogSetZu(n);
  // "Set <Nummer>" ist ein Platzhalter, kein Name; als Treffer überschrieb er
  // beim nächsten Erfassen den echten Namen. Nachgefragt wird höchstens täglich.
  if (cached?.name && cached.name !== `Set ${n}`) return cached;
  if (cached?.fetched_at && Date.now() - new Date(cached.fetched_at).getTime() < 86_400_000) return null;
  const data = await quellen(k).holeSet(n);
  if (!data) {
    await k.rebrickableCache.merkeUnbekanntesSet(n, !!(await quellen(k).getRbKey()));
    return null;
  }
  // Das Thema ist Beiwerk: Ohne es wird das Set trotzdem gemerkt, die Zeile nennt keins.
  const thema = await versuche('rebrickable:thema', quellen(k).getThemeName(data.theme_id ?? 0));
  const theme = thema.ok ? thema.wert : null;
  const row = {
    set_number: n,
    name: data.name || null,
    year: data.year || null,
    theme: theme || null,
    pieces: data.num_parts || null,
    image_url: data.set_img_url || null,
    is_gear: false,
    theme_id: Number(data.theme_id) || null,
  };
  await k.rebrickableCache.merkeSet(row);
  return row;
}

async function setTeileAusCsv(k: KatalogKontext, setNumber: string) {
  const invId = await neuestesInventar(k, setNumber);
  if (!invId) return null;
  const parts = await k.rebrickableCache.inventarTeile(invId);
  if (!parts.length) return null;
  return parts.map(p => ({
    part: {
      part_num: p.part_num,
      name: p.name || p.part_num,
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

export async function getAllSetParts(k: KatalogKontext, setNumber: string) {
  const csvParts = await setTeileAusCsv(k, setNumber);
  if (csvParts) return csvParts;
  const n = mitVersion(setNumber);
  const gemerkt = ausCache<Awaited<ReturnType<typeof holeSetTeile>>['teile']>(
    await k.rebrickableCache.teilelisteAusCache(n),
  );
  if (gemerkt) return gemerkt;
  if (Date.now() - (_leer.get(n) ?? 0) < LEER_MS) return [];
  const { teile, verweigert } = await quellen(k).holeSetTeile(n);
  // Eine Absage (403) wird als leere Liste gemerkt, damit nicht jeder Import erneut fragt.
  if (teile.length > 0 || verweigert) await k.rebrickableCache.merkeTeileliste(n, JSON.stringify(teile));
  else {
    if (_leer.size > 5000) _leer.clear();
    _leer.set(n, Date.now());
  }
  return teile;
}

/** Geteilter Zwischenspeicher: Die Daten ändern sich selten, das Kontingent ist knapp. */
export async function getMinifigParts(k: KatalogKontext, figNumber: string) {
  const gemerkt = ausCache<NonNullable<Awaited<ReturnType<typeof holeFigurTeile>>>>(
    await k.rebrickableCache.figurenteileAusCache(figNumber),
  );
  if (gemerkt) return gemerkt;
  const parts = await quellen(k).holeFigurTeile(figNumber);
  if (!parts) return [];
  // Der Zwischenspeicher spart nur den nächsten Abruf; die Teile gelten auch ohne ihn.
  await versuche(
    'rebrickable:figurenteile-merken',
    k.rebrickableCache.merkeFigurenteile(figNumber, JSON.stringify(parts)),
  );
  return parts;
}
