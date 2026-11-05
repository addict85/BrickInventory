import * as repo from './repository/teileListe';
import { resolveImageLocal } from '../katalog/bilder/images';
import { asIds } from '../haushalt/haushalt';
import type { BlickfeldEingabe, BlickfeldEingabe as Blickfeld } from '../haushalt/haushalt';
import { istErsatzteil, colorId } from '../infra/validate';
import { ensureFresh } from './partsSummary';
import { fetchMissingBlIds } from '../katalog/partsImport';
import type { RbSetTeil } from '../../clients/rebrickable';
import { getRbKey, httpsGetRobust } from '../../clients/rebrickable';
import { getAllSetParts } from '../katalog/rebrickableKatalog';
import { clampPageSize, applyManualCondition, withOwners, MAX_PAGE_SIZE, UNPAGED_LIMIT, SET_PARTS_MAX_PAGE_SIZE } from '../bestand/gemeinsam';
import { meldeUndWeiter, logAndContinue, meldeUndLiefere } from '../infra/fehler';
import { farbkarte as blFarbkarte } from '../finanzen/financeCalc';
import { getGlobalSetting } from '../konto/settings';
import { neuestesInventar } from '../katalog/rbInventar';
import { mitVersion, ohneVersion } from '../sets/setNummer';
import { merkeBlFarbnummer, blFarbnummerAus } from '../katalog/blZuordnung';

/** Mit Ausweichebenen (CSV-Zwischenspeicher, Rebrickable), damit ein Set auch
 * ohne eigene Zeilen eine Teileliste zeigt.
 * Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#abschnitt */

import { marktpreiseAusCacheFuerTeile } from '../finanzen/marketPrice';

/** Ohne manuelle Positionen — die haben eine eigene Ansicht. Hex-Rückfall aus
 * rb_colors für Teile ohne eigenen Wert. */
export async function getPartsColors(userId: Blickfeld) {
  // asIds(), damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Aus der Zusammenfassung (die Mengen sind dort schon mit der Set-Anzahl
  // multipliziert); strict, damit Webapp und App dieselben Zahlen zeigen.
  return repo.farbenDesBestands(uids, await ensureFresh(uids, { strict: true }));
}

function teileFilter(query: Record<string, unknown>): repo.TeileFilter {
  const text = (v: unknown) => (v == null || v === '' ? null : String(v));
  return {
    color: text(query.color), category: text(query.category), search: text(query.search),
    spare: query.spare === '0' || query.spare === '1' ? query.spare : null,
    set_number: query.set_number ? mitVersion(String(query.set_number)) : null,
    storage: text(query.storage),
    // Manuelle Teile haben ihren eigenen Bereich, nicht in der Set-Teileliste.
    ohneManuelle: query.exclude_manual === '1' || query.exclude_manual === true,
  };
}

// Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#teileersatzquelle
async function teileErsatzquelle(set_number: string) {
    // Rebrickable kennt manche Sets nur ohne Versionsanhang.
    const n = mitVersion(set_number), alt = ohneVersion(n);
    const invId = await neuestesInventar(set_number).catch(meldeUndLiefere('teile:neuestesInventar', null));
    if (invId) {
      const csvParts = await repo.inventarAlsTeile(invId, set_number);
      if (csvParts.length > 0)
        // page_size gehört in jeden Rückgabeweg: Der Client entscheidet daran, ob er
        // weiterblättert. Hier kommt alles, also ist es die Zeilenzahl.
        return { parts: csvParts, total: csvParts.length, source: 'csv_cache', page_size: csvParts.length };
    }

    // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#teileersatzquelle-rbkey
    const rbKey = await getGlobalSetting('rebrickable_api_key');
    if (rbKey) {
      for (const sn of [n, alt]) {
        const items = await getAllSetParts(sn).catch(meldeUndLiefere('teile:getAllSetParts', []));
        if (!items?.length) continue;
        const rbParts = items
          .filter((it: RbSetTeil) => !it.is_spare)
          .map((it: RbSetTeil) => ({
            part_number:    it.part?.part_num,
            bl_part_number: it.part?.external_ids?.BrickLink?.[0] || it.part?.part_num,
            part_name:      it.part?.name || it.part?.part_num,
            color_id:       it.color?.id ?? 0,
            color_name:     it.color?.name || '',
            color_hex:      it.color?.rgb || null,
            category_name:  null,
            image_url:      it.part?.part_img_url || null,
            image_local:    null,
            is_spare:       false,
            total_quantity: it.quantity,
            quantity:       it.quantity,
            in_sets:        set_number,
          }))
          .filter((p: { part_number?: string | null }) => p.part_number);
        if (rbParts.length) return { parts: rbParts, total: rbParts.length, source: 'rebrickable', page_size: rbParts.length };
      }
    }

  return null;
}


/** Auf beiden Wegen gleich, sonst blätterten Webapp und App verschieden. */
function seitengroesse(pageSize: unknown, mitSet: boolean): number {
  if (!pageSize) return UNPAGED_LIMIT;
  const obergrenze = mitSet ? SET_PARTS_MAX_PAGE_SIZE : MAX_PAGE_SIZE;
  return Math.min(obergrenze, Math.max(1, parseInt(String(pageSize)) || 100));
}

function teilAlsAntwort(r: repo.TeilZeile) {
  // Das Kotlin-Modell führt is_spare als Boolean; ein '0' liesse die ganze Seite scheitern.
  return { ...r, total_quantity: parseInt(String(r.total_quantity)) || 0,
           is_spare: istErsatzteil(r.is_spare), image_local: resolveImageLocal(r.image_local) };
}

export async function tryPartsSummary(userId: Blickfeld, o: Record<string, unknown>) {
  const uids = asIds(userId);
  // null heisst: Die Live-Abfrage übernimmt. Frisch nur, wenn alle Konten es sind.
  if (!(await ensureFresh(uids))) return null;
  const size = seitengroesse(o.page_size, !!o.set_number);
  const pg   = Math.max(1, parseInt(String(o.page)) || 1);
  try {
    const { total, zeilen } = await repo.seiteAusZusammenfassung(uids, teileFilter(o),
      { groesse: size, versatz: (pg - 1) * size, mitSets: !!o.withSets, ordnung: repo.teileOrdnung(o.ordnung) });
    return { parts: zeilen.map(teilAlsAntwort), total, source: 'summary', page_size: size };
  } catch (e) {
    // Ein Rückfall, kein Fehler: Wie bei fehlender Frische übernimmt die Live-Abfrage.
    meldeUndWeiter('teile:zusammenfassung', e);
    return null;
  }
}

export async function getParts(userId: Blickfeld, query: Record<string, unknown> = {}) {
  const uids = asIds(userId);
  const filter = teileFilter(query);
  const page = query.page ?? 1;
  // Die Sets je Teil braucht nur die Detailansicht; sie kosten Zeit und Nutzlast.
  const withSets = query.with_sets === '1' || query.with_sets === true;
  // Mit Set- oder Lagerortfilter live: Die Zusammenfassung kennt den Lagerort
  // nur verdichtet, und der Filter macht die Menge ohnehin klein.
  if (filter.ohneManuelle && !filter.set_number && !filter.storage) {
    const summary = await tryPartsSummary(uids, { ...query, page, withSets });
    if (summary) return summary;
  }
  const groesse = seitengroesse(query.page_size, !!filter.set_number);
  const versatz = (Math.max(1, parseInt(String(page)) || 1) - 1) * groesse;
  const [{ total, zeilen }, gebraucht] = await Promise.all([
    repo.seiteLive(uids, filter, { groesse, versatz, mitSets: withSets, ordnung: repo.teileOrdnung(query.ordnung) }),
    filter.ohneManuelle ? Promise.resolve([]) : repo.gebrauchteManuelle(uids),
  ]);
  // Eine „Gebraucht"-Erfassung macht das Teil gebraucht; ohne Erfassung 'N'.
  const gebrauchtJe = new Set(gebraucht.filter(r => Number(r.any_used) > 0).map(r => `${r.pid}|${r.color_id}`));
  const parts = zeilen.map(p => ({ ...teilAlsAntwort(p), total_quantity: p.total_quantity,
    condition: gebrauchtJe.has(`${p.part_number}|${p.color_id}`) ? 'U' : 'N', image_url: p.image_url || null }));

  // Im Hintergrund fehlende BrickLink-Nummern nachladen; eine leere bl_id heisst „nachgesehen".
  setImmediate(async () => {
    try {
      if (await repo.hatUngeseheneBlNummer(uids)) fetchMissingBlIds().catch(logAndContinue('teile:fetchMissingBlIds'));
    } catch (e) { meldeUndWeiter('teile:bl-nummern-nachladen', e); }
  });

  if (!parts.length && query.set_number) {
    const ersatz = await teileErsatzquelle(String(query.set_number));
    if (ersatz) return ersatz;
  }
  return { parts, total, source: 'db', page_size: groesse };
}

/** Die Kategorie aus dem eigenen Katalog, sonst aus rb_parts: Rebrickables
 * Set-Teile-Antwort liefert meist keine, die Liste bestünde sonst aus „Unbekannt". */
export async function getPartsCategories(userId: Blickfeld) {
  const uids = asIds(userId);
  return repo.kategorien(uids, await ensureFresh(uids, { strict: true }));
}

export async function getPartsStats(userId: Blickfeld) {
  const uids = asIds(userId);
  // Aus der Zusammenfassung nur, wenn sie frisch ist: Webapp und App zeigen
  // dieselben Zahlen.
  if (await ensureFresh(uids, { strict: true })) {
    const r = await repo.kennzahlen(uids, true);
    if (r) return r;
  }
  return (await repo.kennzahlen(uids, false)) ?? { unique_parts: 0, unique_colors: 0, total_parts: 0, manual_parts: 0 };
}

export async function getBlColorMap() {
  // farbkarte() merkt die Karte zehn Minuten.
  const karte = await blFarbkarte();
  if (karte.size > 0) {
    const map: any = {};
    for (const [id, blId] of karte) map[id] = blId;
    return { map, source: 'db' };
  }
  const key = await getRbKey().catch(meldeUndLiefere('teile:getRbKey', null));
  if (!key) return { map: {}, source: 'empty' };
  // Ohne Typ wäre `{}` für TypeScript leer und `map[c.id] = …` ein Fehler.
  let page = 1, map: Record<string, any> = {}, hasNext = true;
  while (hasNext) {
    const { status, body } = await httpsGetRobust(
      `https://rebrickable.com/api/v3/lego/colors/?page_size=200&page=${page}`,
      { Authorization: `key ${key}` }, 15000
    ).catch(() => ({ status: 0, body: '' }));
    if (status !== 200) break;
    const data = JSON.parse(body);
    for (const c of (data.results || [])) {
      const blId = blFarbnummerAus(c);
      if (blId != null) {
        map[c.id] = blId;
        merkeBlFarbnummer(c.id, blId).catch(logAndContinue('teile:merkeBlFarbnummer'));
      }
    }
    hasNext = !!data.next;
    page++;
  }
  return { map, source: 'api' };
}

/** @param viewerId Wessen EINSTELLUNGEN gelten (Währung) — getrennt von
 *   `userId`, das sagt, wessen DATEN gelesen werden.
 * @param search  Suchtext der Filterleiste; er wirkt auf beide Listen. */
export async function getManualParts(userId: Blickfeld, viewerId: number,
  { page = 1, page_size = null, search = null, storage = null }:
    { page?: unknown; page_size?: unknown; search?: string | null; storage?: string | null } = {}) {
  const uids = asIds(userId);
  const groesse = page_size ? clampPageSize(page_size, 60) : null;
  const seite = groesse ? { groesse, versatz: (Math.max(1, parseInt(String(page)) || 1) - 1) * groesse } : null;
  const rows = await repo.manuelleTeile(uids, { search, storage }, seite);
  const mitZustand = await applyManualCondition(uids, rows, 'part');
  // Eine Abfrage für die ganze Liste; die App liest `avg_price` im Detail.
  const preise: Map<string, number> = await marktpreiseAusCacheFuerTeile(mitZustand, viewerId)
    .catch(meldeUndLiefere('teile:marktpreise', new Map<string, number>()));
  const mitPreis = mitZustand.map(t => ({ ...t, avg_price: preise.get(`${t.part_number}|${t.color_id}`) ?? null }));
  return withOwners(uids, mitPreis);
}

// Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#bestand-max-teile
export const BESTAND_MAX_TEILE = 5000;

export async function getOwnedQuantities(
  blickfeld: BlickfeldEingabe,
  teile: Array<{ part_number?: string; color_id?: number | string }>,
): Promise<Record<string, { gesamt: number; lose: number }>> {
  const uids = asIds(blickfeld);
  // Doppelte Schlüssel fallen weg: Eine Liste über mehrere Sets fragt dasselbe
  // Teil sonst mehrfach.
  const gesehen = new Set<string>();
  const nums: string[] = [];
  const farben: number[] = [];
  for (const t of teile || []) {
    const num = String(t?.part_number ?? '').trim();
    if (!num) continue;
    const farbe = colorId(t?.color_id);
    const key = `${num}|${farbe}`;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    nums.push(num);
    farben.push(farbe);
    if (nums.length >= BESTAND_MAX_TEILE) break;
  }
  if (!nums.length) return {};

  // Ersatzteile zählen MIT: Sie liegen in der Schachtel und lassen sich verbauen
  // — „hat man", nicht „braucht man" wie auf der Bedarfsseite.
  const out: Record<string, { gesamt: number; lose: number }> = {};
  for (const r of await repo.besitzteTeile(uids, nums, farben))
    out[`${r.part_number}|${r.color_id}`] = { gesamt: Number(r.gesamt) || 0, lose: Number(r.lose) || 0 };
  // Minifiguren zählen mit: Eine Teileliste nennt auch die Figuren eines Sets.
  for (const r of await repo.besitzteFiguren(uids, nums)) {
    const key = `${r.part_number}|0`;
    if (out[key]) continue;
    out[key] = { gesamt: Number(r.gesamt) || 0, lose: Number(r.lose) || 0 };
  }
  return out;
}
