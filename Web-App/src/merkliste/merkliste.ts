/** Die Merkliste — was man haben MÖCHTE, getrennt vom Bestand. Ein Helfer
 * statt Code in den Routen, weil beide Oberflächen und mehrere Erfassungswege
 * dieselben Regeln brauchen. */
import { blickfeldAus } from '../haushalt/haushalt';
import type { Sicht } from '../haushalt/haushalt';
import { nacharbeit } from '../auftraege/nacharbeit';
import { LIKE_ESCAPE, enthaeltMuster } from '../../db/likeSuche';
import { addSet, sanitizeSetNumber } from '../sets/setService';
import { findSetInScope } from '../sets/setAdd';
import { loescheAlarm } from '../finanzen/preisalarm';
import * as V from '../infra/validate';
import { geldEingabe } from '../infra/geld';
import { nutzerStandardZustand, getSetting } from '../einstellungen/settings';
import { meldeUndWeiter, meldeUndLiefere, oeffentlicherFehler } from '../infra/fehler';
import { fuerSet } from '../katalog/preisvergleich';
import { resolveIfExists } from '../katalog/bilder/images';
import { toCsv, csvZeilenAusAnfrage, parseCsvDate } from '../infra/csvExport';
import * as repo from './repository/merkliste';
import { fetchPrice } from '../finanzen/financeCalc';

/** Jeder Zustand für sich: Kennt BrickLink einen nicht, kommt der andere
 * trotzdem, und ein fehlender Preis ist ein Strich, kein Fehler. */
export async function preiseBeiderZustaende(uid: number, setNumber: string) {
  const currency  = String(await getSetting(uid, 'currency', 'EUR'));
  const guideType = String(await getSetting(uid, 'price_guide_type', 'sold'));
  const ttlHours  = String(await getSetting(uid, 'price_cache_ttl', '24'));
  const current: Record<string, { condition: string; avg_price: unknown; min_price: unknown; max_price: unknown }> = {};
  for (const c of ['N', 'U']) {
    const pd = await fetchPrice(setNumber, c, guideType, currency, ttlHours)
      .catch(meldeUndLiefere(`merkliste:preis ${setNumber} ${c}`, null));
    // Ein Ersatzpreis des anderen Zustands stünde sonst als „Marktpreis (Neuware)“ da, die Liste sagt „keiner“.
    if (pd && !pd.is_fallback) current[c] = { condition: c, avg_price: pd.avg_price, min_price: pd.min_price, max_price: pd.max_price };
  }
  return { currency, current };
}

export interface Merkposten {
  set_number: string;
  condition: string;
  created_at: string;
  /** Im Kontenbaum sieht man fremde Merkposten mit. */
  user_id: number;
  /** Im Zustand DIESES Merkpostens, aus dem Cache — null, solange keiner bekannt ist.
   * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkposten */
  marktpreis: number | null;
  waehrung: string;
  /** Aus rb_sets, nicht mitgespeichert (siehe Migration 0021). */
  name: string | null;
  year: number | null;
  theme_id: number | null;
  num_parts: number | null;
  image_url: string | null;
  /** Lokal statt CDN, weil die CSP fremde Bildquellen sperrt.
   * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkposten-2 */
  image_local: string | null;
  owned: boolean;
  /** Reist mit: Ein Alarm, den man nirgends mehr sieht, ist vergessen. */
  alarm: { richtung: string; schwelle: number; ausgeloest: boolean } | null;
  /** Am Merkposten statt am Katalog: Der Knopf braucht nur die Setnummer.
   * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkposten-4 */
  preisvergleich_url: string;
}

/** Ohne Angabe gilt die Einstellung des Nutzers, nicht hart 'N' — die
 * Verwechslung verbuchte einmal eine Erfassung mit falschem Preis. */
export async function zustandOder(condition: unknown, userId: number): Promise<string> {
  const c = String(condition ?? '').trim().toUpperCase();
  if (c === 'N' || c === 'U') return c;
  return await nutzerStandardZustand(userId);
}

/** ON CONFLICT statt vorher fragen: Zwei Geräte gleichzeitig sollen keinen Fehler sehen. */
export async function legeMerkpostenAn(
  userId: number, setNumber: string, condition: unknown, aufgenommenAm?: string | null,
): Promise<{ merkposten: Merkposten | null; war_neu: boolean }> {
  const sn = sanitizeSetNumber(setNumber);
  const c  = await zustandOder(condition, userId);
  const r = await repo.merkeSetVor(userId, sn, c, aufgenommenAm ?? null);
  const liste = await merkpostenVon([userId], sn);
  return { merkposten: liste.find(w => w.condition === c) ?? null, war_neu: !!r?.war_neu };
}

/** Kein Fehler, wenn es keinen gab — das Ziel ist erreicht. */
export async function loescheMerkposten(userId: number, setNumber: string, condition: unknown): Promise<number> {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await repo.streicheVormerkung(userId, sanitizeSetNumber(setNumber), c);
  return r.changes ?? 0;
}

// Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#verschiebemerkposten
export async function verschiebeMerkposten(
  vonId: number, setNumber: string, condition: unknown, zuId: number,
): Promise<{ verschoben: boolean; zusammengefuehrt: boolean }> {
  const sn = sanitizeSetNumber(setNumber);
  const c  = String(condition ?? 'N').toUpperCase() === 'U' ? 'U' : 'N';
  if (vonId === zuId) return { verschoben: false, zusammengefuehrt: false };

  const schon = await repo.istVorgemerkt(zuId, sn, c);

  if (schon) {
    const weg = await loescheMerkposten(vonId, sn, c);
    await loescheAlarm(vonId, sn, c);
    return { verschoben: weg > 0, zusammengefuehrt: true };
  }

  const r = await repo.uebertrageVormerkung(zuId, vonId, sn, c);
  const verschoben = (r.changes ?? 0) > 0;
  // Den Alarm NUR mitnehmen, wenn der Merkposten wirklich gewandert ist.
  if (verschoben) {
    await repo.uebertrageAlarm(zuId, vonId, sn, c).catch((e: unknown) => meldeUndWeiter('merkliste:alarm-umhaengen', e));
  }
  return { verschoben, zusammengefuehrt: false };
}

/** Dieselben Namen wie SET_SORTS: Beide Oberflächen beschriften sie gleich.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merk-sorts */
const MERK_SORTS = {
  added_desc: 'w.created_at DESC',
  added_asc:  'w.created_at ASC',
  name_asc:   'COALESCE(rb.name, sc.name) ASC NULLS LAST',
  num_asc:    'w.set_number ASC',
  year_desc:  'COALESCE(rb.year, sc.year) DESC NULLS LAST',
  price_desc: 'pc.avg_price DESC NULLS LAST',
  price_asc:  'pc.avg_price ASC NULLS LAST',
};

export interface MerkFilter {
  /** Nummer ODER Name, Teilzeichenkette, Gross-/Kleinschreibung egal. */
  suche?: unknown;
  /** 'N' oder 'U'. Alles andere heisst: beide. */
  zustand?: unknown;
  /** Unbekanntes fällt auf added_desc zurück. */
  sortierung?: unknown;
}

/** `userIds`: Die Merkliste folgt dem Kontenbaum wie alles andere.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkpostenvon */
export async function merkpostenVon(
  userIdsWahl: Sicht | number[], nurSet?: string, waehrung = 'EUR', filter?: MerkFilter,
): Promise<Merkposten[]> {
  const userIds = await blickfeldAus(userIdsWahl);
  if (!userIds?.length) return [];
  const params: unknown[] = [userIds];
  let wo = '';
  if (nurSet) { params.push(sanitizeSetNumber(nurSet)); wo += ` AND w.set_number = $${params.length}`; }

  // Nummer UND Name, wie in der Galerie; der Name kommt aus dem JOIN auf rb_sets.
  const suche = String(filter?.suche ?? '').trim();
  if (suche) {
    params.push(enthaeltMuster(suche));
    wo += ` AND (w.set_number ILIKE $${params.length}${LIKE_ESCAPE}`
        + ` OR COALESCE(rb.name, sc.name) ILIKE $${params.length}${LIKE_ESCAPE})`;
  }

  // Unbekannt heisst „beide", nicht „keine": Eine geleerte Liste sähe aus wie
  // eine leere Merkliste.
  const zustand = String(filter?.zustand ?? '').toUpperCase();
  if (zustand === 'N' || zustand === 'U') {
    params.push(zustand);
    wo += ` AND w.condition = $${params.length}`;
  }

  // ausTabelle(): Der direkte Zugriff fände auch geerbte Eigenschaften wie „constructor".
  const ordnung = V.ausTabelle(MERK_SORTS, filter?.sortierung, MERK_SORTS.added_desc);

  params.push(waehrung);
  const pWaehrung = `$${params.length}`;
  const rows = await repo.merklisteImBlickfeld(params, pWaehrung, wo, ordnung);

  type Zeile = Omit<Merkposten, 'year' | 'num_parts' | 'owned' | 'alarm' | 'preisvergleich_url'
                            | 'image_local' | 'marktpreis' | 'waehrung'> &
               { year: string | number | null; num_parts: string | number | null; owned: unknown;
                 alarm_richtung: string | null; alarm_schwelle: string | number | null;
                 alarm_ausgeloest: unknown; marktpreis: string | number | null };
  // Das Bild hier bestellen: Der Proxy legt nur für Vorschauen eine Notiz an,
  // das Detail fragt aber das volle Bild.
  // Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkpostenvon-2

  return ((rows ?? []) as Zeile[]).map(({ alarm_richtung, alarm_schwelle, alarm_ausgeloest, ...r }) => {
    // Synchron und gecacht — kein Dateisystemzugriff je Zeile. Dieselbe Namensregel
    // wie beim Ablegen (src/katalog/bilder/setImages.ts).
    const lokal = resolveIfExists(
      `/images/sets/${String(r.set_number).replace(/[^a-z0-9-]/gi, '_')}.jpg`) ?? null;
    if (!lokal && r.image_url) nacharbeit().bildVormerken(String(r.image_url), String(r.set_number));
    return {
      ...r,
      year:      r.year      == null ? null : Number(r.year),
      num_parts: r.num_parts == null ? null : Number(r.num_parts),
      // Number() als Netz: Der Zeilentyp lässt `string | number` zu.
      marktpreis: r.marktpreis == null ? null : Number(r.marktpreis),
      waehrung,
      owned:     !!r.owned,
      preisvergleich_url: fuerSet(r.set_number, r.name),
      image_local: lokal,
      alarm: alarm_richtung == null ? null : {
        richtung:   alarm_richtung,
        schwelle:   parseFloat(String(alarm_schwelle)),
        ausgeloest: !!alarm_ausgeloest,
      },
    };
  });
}

/** Über addSet(), die eine Wahrheit fürs Erfassen, statt eines eigenen INSERT.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#uebernimm */
export async function uebernimm(
  leserId: number, besitzerId: number, setNumber: string, condition: unknown,
  eingabe: { quantity?: unknown; purchase_price?: unknown; condition?: unknown;
             storage?: unknown } = {},
): Promise<{ action: string; set_number: string }> {
  const sn = sanitizeSetNumber(setNumber);

  // Zwei Zustände: `condition` ist der Schlüssel des Merkpostens, der
  // verschwindet; `eingabe.condition` der, in dem das Set erfasst wird.
  const merkpostenZustand = await zustandOder(condition, besitzerId);
  const zustand = eingabe.condition == null
    ? merkpostenZustand
    : await zustandOder(eingabe.condition, besitzerId);

  // Schon im Blickfeld? Dann NICHT die Menge erhöhen (src/sets/setAdd.ts). Der
  // Merkposten ist trotzdem erledigt und verschwindet.
  const vorhanden = await findSetInScope(leserId, sn);
  const ergebnis = vorhanden
    ? { action: 'exists', set_number: sn }
    : await addSet(sn, V.acquisitionQuantity(eingabe.quantity ?? 1), besitzerId, null,
                   geldEingabe(eingabe.purchase_price, 'Kaufpreis'), zustand,
                   eingabe.storage == null ? null : String(eingabe.storage));

  // Nach dem MERKPOSTEN-Zustand: Es geht um die Zeile, die man erfüllt hat.
  await loescheMerkposten(besitzerId, sn, merkpostenZustand);
  await loescheAlarm(besitzerId, sn, merkpostenZustand);
  return ergebnis as { action: string; set_number: string };
}

/** Nur Konto, Set, Zustand und Datum: Alles andere leitet die Ansicht ab.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#buildmerklistecsv */
export async function buildMerklisteCsv(uid: number): Promise<string> {
  const rows = await repo.merklisteFuerExport(uid);

  return toCsv(['set_number', 'condition', 'created_at'], rows);
}

/** Das Gegenstück zu buildMerklisteCsv(); läuft als Auftrag (jobs/importAuftraege.ts). */
export async function importiereMerklisteCsv(owner: number, text: string) {
  const { records, bereinigt, uebersprungen } =
    csvZeilenAusAnfrage(text);

  let added = 0, updated = 0, errors = 0;
  const results: any[] = [];

  for (const row of bereinigt) {
    // Letzter Rückfall: eine Datei ohne Kopfzeile, erste Spalte = Setnummer —
    // dieselbe Nachsicht wie beim Minifiguren-Import.
    const setNumber = String(row.set_number || row['Setnummer'] || row['set_num']
                             || Object.values(row)[0] || '').trim();
    if (!setNumber) continue;

    const condition = String(row.condition || row['zustand'] || row['Zustand'] || '').trim();
    const am = parseCsvDate(row.created_at || row['aufgenommen_am'] || row['Auf der Liste seit']);

    try {
      const { war_neu } = await legeMerkpostenAn(owner, setNumber, condition, am);
      if (war_neu) { added++; results.push({ set_number: setNumber, action: 'added' }); }
      else         { updated++; results.push({ set_number: setNumber, action: 'exists' }); }
    } catch (e) {
      errors++;
      results.push({ set_number: setNumber, action: 'error', error: oeffentlicherFehler(e, 'wanted-csv:zeile').error });
    }
  }
  return { added, updated, errors, records, results, uebersprungen };
}
