/** Die Merkliste — was man haben MÖCHTE, getrennt vom Bestand. Ein Helfer
 * statt Code in den Routen, weil beide Oberflächen und mehrere Erfassungswege
 * dieselben Regeln brauchen. */
import { blickfeldAus } from '../haushalt/haushalt';
import type { Sicht } from '../haushalt/haushalt';
import { nacharbeit } from '../auftraege/nacharbeit';
import { addSet, sanitizeSetNumber, findSetInScope } from '../sets';
import { loescheAlarm, alarmUebertragen } from '../finanzen/preisalarm';
import * as V from '../infra/validate';
import { fachfehler } from '../infra/fehlerTexte';
import { geldEingabe } from '../infra/geld';
import { nutzerStandardZustand, getSetting } from '../einstellungen/settings';
import { meldeFehler, oeffentlicherFehler } from '../infra/fehler';
import { Abstriche } from '../infra/ergebnis';
import { fuerSet } from '../katalog/preisvergleich';
import { resolveIfExists } from '../katalog/bilder/images';
import { toCsv, csvZeilenAusAnfrage, parseCsvDate } from '../infra/csvExport';
import * as repo from './repository/merkliste';
import { fetchPrice } from '../finanzen/financeCalc';
import { setBekanntImKatalog } from '../katalog/bricklinkPreise';
import { moeglicheSetNummer, mitVersion } from '../infra/setNummer';

/** Jeder Zustand für sich: Kennt BrickLink einen nicht, kommt der andere
 * trotzdem, und ein fehlender Preis ist ein Strich, kein Fehler. */
export async function preiseBeiderZustaende(uid: number, setNumber: string) {
  const currency  = String(await getSetting(uid, 'currency', 'EUR'));
  if (!moeglicheSetNummer(mitVersion(setNumber)) || !await setBekanntImKatalog(setNumber)) return { currency, current: {} };
  const guideType = String(await getSetting(uid, 'price_guide_type', 'sold'));
  const ttlHours  = String(await getSetting(uid, 'price_cache_ttl', '24'));
  const current: Record<string, { condition: string; avg_price: unknown; min_price: unknown; max_price: unknown }> = {};
  // „keiner“ nach einem Abruffehler ist nicht „BrickLink kennt keinen“.
  const ab = new Abstriche();
  for (const c of ['N', 'U']) {
    const pd = await ab.oder(`marktpreis_${c}`, fetchPrice(setNumber, c, guideType, currency, ttlHours), null);
    // Ein Ersatzpreis des anderen Zustands stünde sonst als „Marktpreis (Neuware)“ da, die Liste sagt „keiner“.
    if (pd && !pd.is_fallback) current[c] = { condition: c, avg_price: pd.avg_price, min_price: pd.min_price, max_price: pd.max_price };
  }
  return { currency, current, ...ab.angabe() };
}

export interface Merkposten {
  set_number: string;
  condition: string;
  created_at: string;
  /** Im Kontenbaum sieht man fremde Merkposten mit. */
  user_id: number;
  /** Im Zustand DIESES Merkpostens, aus dem Cache — null, solange keiner bekannt ist. */
  marktpreis: number | null;
  waehrung: string;
  /** Aus rb_sets, nicht mitgespeichert (siehe Migration 0021). */
  name: string | null;
  year: number | null;
  theme_id: number | null;
  num_parts: number | null;
  image_url: string | null;
  /** Lokal statt CDN, weil die CSP fremde Bildquellen sperrt. */
  image_local: string | null;
  owned: boolean;
  /** Reist mit: Ein Alarm, den man nirgends mehr sieht, ist vergessen. */
  alarm: { richtung: string; schwelle: number; ausgeloest: boolean } | null;
  /** Am Merkposten statt am Katalog: Der Knopf braucht nur die Setnummer. */
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

// UPDATE statt löschen und neu anlegen: Aufnahmedatum und Preisalarm bleiben.
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
    await alarmUebertragen(zuId, vonId, sn, c).catch((e: unknown) => meldeFehler('merkliste:alarm-umhaengen', e));
  }
  return { verschoben, zusammengefuehrt: false };
}

export interface MerkFilter {
  /** Nummer ODER Name, Teilzeichenkette, Gross-/Kleinschreibung egal. */
  suche?: unknown;
  /** 'N' oder 'U'. Alles andere heisst: beide. */
  zustand?: unknown;
  /** Unbekanntes fällt auf added_desc zurück. */
  sortierung?: unknown;
}

/** `userIds`: Die Merkliste folgt dem Kontenbaum wie alles andere. */
export async function merkpostenVon(
  userIdsWahl: Sicht | number[], nurSet?: string, waehrung = 'EUR', filter?: MerkFilter,
): Promise<Merkposten[]> {
  const userIds = await blickfeldAus(userIdsWahl);
  if (!userIds?.length) return [];
  // Unbekannt heisst „beide", nicht „keine": Eine geleerte Liste sähe aus wie
  // eine leere Merkliste.
  const zustand = String(filter?.zustand ?? '').toUpperCase();
  const rows = await repo.merklisteImBlickfeld(userIds, {
    nurSet: nurSet ? sanitizeSetNumber(nurSet) : null,
    suche: String(filter?.suche ?? '').trim() || null,
    zustand: zustand === 'N' || zustand === 'U' ? zustand : null,
    sortierung: filter?.sortierung,
  }, waehrung);

  type Zeile = Omit<Merkposten, 'year' | 'num_parts' | 'owned' | 'alarm' | 'preisvergleich_url'
                            | 'image_local' | 'marktpreis' | 'waehrung'> &
               { year: string | number | null; num_parts: string | number | null; owned: unknown;
                 alarm_richtung: string | null; alarm_schwelle: string | number | null;
                 alarm_ausgeloest: unknown; marktpreis: string | number | null };
  // Das Bild hier bestellen: Der Proxy legt nur für Vorschauen eine Notiz an,
  // das Detail fragt aber das volle Bild.

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

/** Über addSet(), die eine Wahrheit fürs Erfassen, statt eines eigenen INSERT. */
export async function uebernimm(
  leserId: number, besitzerId: number, setNumber: string, condition: unknown,
  eingabe: { quantity?: unknown; purchase_price?: unknown; condition?: unknown;
             storage?: unknown } = {},
): Promise<{ action: string; set_number: string }> {
  const sn = sanitizeSetNumber(setNumber);

  // Zwei Zustände: `condition` ist der Schlüssel des Merkpostens, der
  // verschwindet; `eingabe.condition` der, in dem das Set erfasst wird.
  const merkpostenZustand = await zustandOder(condition, besitzerId);
  // Übernommen wird ein Merkposten; ohne ihn wäre das ein zweiter Weg zum Erfassen.
  if (!await repo.istVorgemerkt(besitzerId, sn, merkpostenZustand)) fachfehler('nicht_gefunden', 'nicht_gefunden');
  const zustand = eingabe.condition == null
    ? merkpostenZustand
    : await zustandOder(eingabe.condition, besitzerId);

  // Schon im Blickfeld? Dann NICHT die Menge erhöhen (src/sets/erfassen.ts). Der
  // Merkposten ist trotzdem erledigt und verschwindet.
  const vorhanden = await findSetInScope(leserId, sn);
  const ergebnis = vorhanden
    ? { action: 'exists', set_number: sn }
    : await addSet({ setNumber: sn, menge: V.acquisitionQuantity(eingabe.quantity ?? 1), konto: besitzerId,
                     kaufpreis: geldEingabe(eingabe.purchase_price, 'Kaufpreis'), zustand,
                     lagerort: eingabe.storage == null ? null : String(eingabe.storage) });

  // Nach dem MERKPOSTEN-Zustand: Es geht um die Zeile, die man erfüllt hat.
  await loescheMerkposten(besitzerId, sn, merkpostenZustand);
  await loescheAlarm(besitzerId, sn, merkpostenZustand);
  return ergebnis as { action: string; set_number: string };
}

/** Nur Konto, Set, Zustand und Datum: Alles andere leitet die Ansicht ab. */
export async function buildMerklisteCsv(uid: number): Promise<string> {
  const rows = await repo.merklisteFuerExport(uid);

  return toCsv(['set_number', 'condition', 'created_at'], rows);
}

/** Das Gegenstück zu buildMerklisteCsv(); läuft als Auftrag (src/sammlung/importAuftraege.ts). */
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
