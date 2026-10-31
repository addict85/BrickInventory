/**
 * Die Merkliste — was man haben MÖCHTE, getrennt von dem, was man hat.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#abschnitt
 */
import { nacharbeit } from '../../utils/nacharbeit';
import * as db from '../../db/database';
import { addSet, sanitizeSetNumber } from '../sets/setService';
import { findSetInScope } from '../sets/setAdd';
import { loescheAlarm } from '../finanzen/preisalarm';
import * as V from '../infra/validate';
import { nutzerStandardZustand } from '../konto/settings';
import { meldeUndWeiter } from '../infra/httpError';
import { fuerSet } from '../finanzen/preisvergleich';
import { resolveIfExists } from '../../utils/images';
import { toCsv } from '../infra/csvExport';

/** Ein Eintrag, wie ihn beide Oberflächen sehen. */
export interface Merkposten {
  set_number: string;
  condition: string;
  created_at: string;
  /** Wem der Merkposten gehört — im Kontenbaum sieht man fremde mit. */
  user_id: number;
  /**
   * Der Marktpreis im Zustand DIESES Merkpostens — null, solange keiner
   * bekannt ist.
   * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkposten
   */
  marktpreis: number | null;
  /** Die Waehrung, in der [marktpreis] steht. */
  waehrung: string;
  /** Aus rb_sets, nicht mitgespeichert (siehe Migration 0021). */
  name: string | null;
  year: number | null;
  theme_id: number | null;
  num_parts: number | null;
  image_url: string | null;
  /**
   * Die lokal abgelegte Bilddatei — wenn es sie gibt.
   * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkposten-2
   */
  image_local: string | null;
  /** Liegt das Set schon in der Galerie eines Kontos im Blickfeld? */
  owned: boolean;
  /**
   * Der Preisalarm zu GENAU diesem Merkposten — oder null.
   * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkposten-3
   */
  alarm: { richtung: string; schwelle: number; ausgeloest: boolean } | null;
  /**
   * Preisvergleich — die Adresse, die der Knopf im Detail oeffnet.
   * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkposten-4
   */
  preisvergleich_url: string;
}

/**
 * Zustand auf 'N' oder 'U' bringen.
 *
 * Ohne Angabe gilt die Einstellung des Nutzers — nicht hart 'N'. Genau diese
 * Verwechslung hat in addSet() einmal dazu geführt, dass eine Erfassung den
 * Gebrauchtpreis bekam und als neu verbucht wurde (siehe der Kommentar dort).
 */
export async function zustandOder(condition: unknown, userId: number): Promise<string> {
  const c = String(condition ?? '').trim().toUpperCase();
  if (c === 'N' || c === 'U') return c;
  return await nutzerStandardZustand(userId);
}

/**
 * Einen Merkposten anlegen.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#legemerkpostenan
 */
export async function legeMerkpostenAn(
  userId: number, setNumber: string, condition: unknown, aufgenommenAm?: string | null,
): Promise<{ merkposten: Merkposten | null; war_neu: boolean }> {
  const sn = sanitizeSetNumber(setNumber);
  const c  = await zustandOder(condition, userId);
  const r = await db.get(
    `INSERT INTO wanted (user_id, set_number, condition, created_at)
     VALUES ($1,$2,$3, COALESCE($4::timestamptz, NOW()))
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET condition = wanted.condition
     RETURNING (xmax = 0) AS war_neu`,
    [userId, sn, c, aufgenommenAm ?? null]);
  const liste = await merkpostenVon([userId], sn);
  return { merkposten: liste.find(w => w.condition === c) ?? null, war_neu: !!r?.war_neu };
}

/** Merkposten entfernen. Kein Fehler, wenn es keinen gab — das Ziel ist erreicht. */
export async function loescheMerkposten(userId: number, setNumber: string, condition: unknown): Promise<number> {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await db.run(
    'DELETE FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3',
    [userId, sanitizeSetNumber(setNumber), c]);
  return r.changes ?? 0;
}

/**
 * Den Merkposten einem anderen Konto geben.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#verschiebemerkposten
 * @returns verschoben=false heisst: Es gab nichts zu verschieben (kein Merkposten
 */
export async function verschiebeMerkposten(
  vonId: number, setNumber: string, condition: unknown, zuId: number,
): Promise<{ verschoben: boolean; zusammengefuehrt: boolean }> {
  const sn = sanitizeSetNumber(setNumber);
  const c  = String(condition ?? 'N').toUpperCase() === 'U' ? 'U' : 'N';
  if (vonId === zuId) return { verschoben: false, zusammengefuehrt: false };

  const schon = await db.get(
    'SELECT 1 FROM wanted WHERE user_id=$1 AND set_number=$2 AND condition=$3',
    [zuId, sn, c]);

  if (schon) {
    const weg = await loescheMerkposten(vonId, sn, c);
    await loescheAlarm(vonId, sn, c);
    return { verschoben: weg > 0, zusammengefuehrt: true };
  }

  const r = await db.run(
    'UPDATE wanted SET user_id=$1 WHERE user_id=$2 AND set_number=$3 AND condition=$4',
    [zuId, vonId, sn, c]);
  const verschoben = (r.changes ?? 0) > 0;
  // Den Alarm NUR mitnehmen, wenn der Merkposten wirklich gewandert ist — sonst
  // haengte eine fehlgeschlagene Verschiebung trotzdem den Alarm um.
  if (verschoben) {
    await db.run(
      'UPDATE price_alerts SET user_id=$1 WHERE user_id=$2 AND set_number=$3 AND condition=$4',
      [zuId, vonId, sn, c]).catch((e: unknown) => meldeUndWeiter('merkliste:alarm-umhaengen', e));
  }
  return { verschoben, zusammengefuehrt: false };
}

/**
 * Die Sortierungen der Merkliste.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merk-sorts
 */
const MERK_SORTS = {
  added_desc: 'w.created_at DESC',
  added_asc:  'w.created_at ASC',
  name_asc:   'COALESCE(rb.name, sc.name) ASC NULLS LAST',
  num_asc:    'w.set_number ASC',
  year_desc:  'COALESCE(rb.year, sc.year) DESC NULLS LAST',
  price_desc: 'pc.avg_price DESC NULLS LAST',
  price_asc:  'pc.avg_price ASC NULLS LAST',
};

/**
 * Suche, Zustand und Sortierung — Marcos Vorgabe „in der Merkliste noch einen
 * Filter analog den Sets einbauen inkl. Inhaber".
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkfilter
 */
export interface MerkFilter {
  /** Nummer ODER Name, Teilzeichenkette, Gross-/Kleinschreibung egal. */
  suche?: unknown;
  /** 'N' oder 'U'. Alles andere heisst: beide. */
  zustand?: unknown;
  /** Ein Schluessel aus MERK_SORTS. Unbekanntes faellt auf added_desc zurueck. */
  sortierung?: unknown;
}

/**
 * Die Merkposten eines Blickfelds.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkpostenvon
 */
export async function merkpostenVon(
  userIds: number[], nurSet?: string, waehrung = 'EUR', filter?: MerkFilter,
): Promise<Merkposten[]> {
  if (!userIds?.length) return [];
  const params: unknown[] = [userIds];
  let wo = '';
  if (nurSet) { params.push(sanitizeSetNumber(nurSet)); wo += ` AND w.set_number = $${params.length}`; }

  // Die Suche trifft Nummer UND Namen
  // Dieselbe Erwartung wie in der Galerie: Wer „Falcon" tippt, sucht nicht
  // nach einer Nummer, und wer „75192" tippt, nicht nach einem Namen. Der Name
  // steht nicht in `wanted`, sondern kommt aus dem LEFT JOIN auf rb_sets …
  // Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkpostenvon-suche
  const suche = String(filter?.suche ?? '').trim();
  if (suche) {
    // Prozent, Unterstrich und der Gegenschraegstrich sind in LIKE
    // Platzhalter. Ohne das Maskieren faende die Eingabe eines Prozentzeichens
    // JEDEN Eintrag — sichtbar harmlos, aber es ist nicht, wonach gefragt
    // wurde. ESCAPE benennt das Maskierzeichen ausdruecklich, damit die
    // Abfrage nicht von standard_conforming_strings abhaengt.
    const roh = suche.replace(/[\\%_]/g, (z) => '\\' + z);
    params.push(`%${roh}%`);
    wo += ` AND (w.set_number ILIKE $${params.length} ESCAPE '\\'`
        + ` OR COALESCE(rb.name, sc.name) ILIKE $${params.length} ESCAPE '\\')`;
  }

  // Nur 'N' und 'U' sind Zustaende; alles andere heisst „beide" und nicht
  // „keine". Ein unbekannter Wert soll die Liste nicht leeren — das saehe aus
  // wie eine leere Merkliste.
  const zustand = String(filter?.zustand ?? '').toUpperCase();
  if (zustand === 'N' || zustand === 'U') {
    params.push(zustand);
    wo += ` AND w.condition = $${params.length}`;
  }

  // ausTabelle() und nicht `MERK_SORTS[x] || …`: Der direkte Zugriff findet
  // auch geerbte Eigenschaften, und „constructor" waere damit eine gueltige
  // Sortierung gewesen. Dieselbe Begruendung steht bei den Sets.
  const ordnung = V.ausTabelle(MERK_SORTS, filter?.sortierung, MERK_SORTS.added_desc);

  params.push(waehrung);
  const pWaehrung = `$${params.length}`;
  const rows = await db.all(
    `SELECT w.set_number, w.condition, w.created_at, w.user_id,
            COALESCE(rb.name, sc.name) AS name, COALESCE(rb.year, sc.year) AS year, rb.theme_id,
            COALESCE(rb.num_parts, sc.pieces) AS num_parts,
            COALESCE(rb.set_img_url, sc.image_url) AS image_url,
            pa.richtung AS alarm_richtung, pa.schwelle AS alarm_schwelle,
            pa.ausgeloest AS alarm_ausgeloest,
            pc.avg_price AS marktpreis,
            EXISTS (SELECT 1 FROM sets s
                     WHERE s.user_id = ANY($1) AND s.set_number = w.set_number) AS owned
       FROM wanted w
       LEFT JOIN rb_sets rb ON rb.set_num = w.set_number
       -- Ohne Rebrickable-Katalog kennt set_catalog (wie in der Sammlung) Name und Bild.
       LEFT JOIN set_catalog sc ON sc.set_number = w.set_number
       LEFT JOIN price_alerts pa ON pa.user_id = w.user_id
                                AND pa.set_number = w.set_number
                                AND pa.condition = w.condition
       -- Der Marktpreis im Zustand DIESES Merkpostens. Ohne die
       -- Zustandsbedingung stuende beim gebrauchten Merkposten der Neupreis —
       -- dieselbe Verwechslung, die in addSet() schon einmal einen
       -- Gebrauchtpreis als Neuzugang verbucht hat.
       LEFT JOIN price_cache pc ON pc.set_number = w.set_number
                               AND pc.condition = w.condition
                               AND pc.currency_code = ${pWaehrung}
      WHERE w.user_id = ANY($1)${wo}
      ORDER BY ${ordnung}, w.set_number, w.condition`,
    params);

  // Die Zahlenspalten kommen als Zeichenkette aus dem Treiber — dieselbe
  // Stelle, an der in diesem Baum schon einmal ein Vergleich still falsch
  // wurde (siehe src/finanzen/preisalarm.ts).
  type Zeile = Omit<Merkposten, 'year' | 'num_parts' | 'owned' | 'alarm' | 'preisvergleich_url'
                            | 'image_local' | 'marktpreis' | 'waehrung'> &
               { year: string | number | null; num_parts: string | number | null; owned: unknown;
                 alarm_richtung: string | null; alarm_schwelle: string | number | null;
                 alarm_ausgeloest: unknown; marktpreis: string | number | null };
  // Fehlt das Bild noch, wird es hier bestellt
  // Er hat recht, und der Grund steht im Proxy: Eine Notiz fuer den Bild-Job
  // entsteht dort NUR, wenn eine Vorschau angefragt wurde (routes/imgProxy.ts:
  // `if (wantThumb) { … } else notiere();`). Das Merkposten-Detail fragt die volle …
  // Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkpostenvon-2

  return ((rows ?? []) as Zeile[]).map(({ alarm_richtung, alarm_schwelle, alarm_ausgeloest, ...r }) => {
    // Synchron und gecacht (utils/images.ts) — kein Dateisystemzugriff je
    // Zeile und Aufruf. Dieselbe Namensregel wie beim Ablegen
    // (utils/setImages.ts: /images/sets/<setnummer>.jpg).
    //
    // ?? null: resolveIfExists() ist als „string | null | undefined"
    // typisiert; ein fehlendes Bild steht in der Antwort als NULL und nicht
    // als fehlendes Feld, sonst muessten beide Oberflaechen zwei Faelle kennen.
    const lokal = resolveIfExists(
      `/images/sets/${String(r.set_number).replace(/[^a-z0-9-]/gi, '_')}.jpg`) ?? null;
    if (!lokal && r.image_url) nacharbeit().bildVormerken(String(r.image_url), String(r.set_number));
    return {
      ...r,
      year:      r.year      == null ? null : Number(r.year),
      num_parts: r.num_parts == null ? null : Number(r.num_parts),
      // Number() ist hier ein NETZ, keine Umrechnung: NACHGEMESSEN liefert der
      // Treiber NUMERIC bereits als Zahl, weil db/database.ts:63 dafuer einen
      // Typ-Leser setzt (parseFloat). Die Zeile bleibt trotzdem stehen — der
      // Zeilentyp laesst `string | number` zu, und ohne sie haengt die …
      // Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#merkpostenvon-3
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

/**
 * Einen Merkposten in die Galerie uebernehmen.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#uebernimm
 */
export async function uebernimm(
  leserId: number, besitzerId: number, setNumber: string, condition: unknown,
  eingabe: { quantity?: unknown; purchase_price?: unknown; condition?: unknown;
             storage?: unknown } = {},
): Promise<{ action: string; set_number: string }> {
  const sn = sanitizeSetNumber(setNumber);

  // ZWEI Zustaende, und sie sind nicht dasselbe
  // `condition` (Pfad) ist der Zustand des MERKPOSTENS — der Schluessel der
  // Zeile, die verschwindet. `eingabe.condition` ist der Zustand, in dem das
  // Set tatsaechlich ERFASST wird.
  // Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#uebernimm-merkpostenzustand
  const merkpostenZustand = await zustandOder(condition, besitzerId);
  const zustand = eingabe.condition == null
    ? merkpostenZustand
    : await zustandOder(eingabe.condition, besitzerId);

  // Schon im Blickfeld? Dann NICHT die Menge erhoehen — dieselbe Regel wie
  // beim Erfassen (src/sets/setAdd.ts), damit sie nicht davon abhaengt, ueber
  // welchen der vier Wege jemand kommt. Der Merkposten ist trotzdem erledigt
  // und verschwindet; sonst bliebe er fuer ein Set stehen, das man hat.
  const vorhanden = await findSetInScope(leserId, sn);
  const ergebnis = vorhanden
    ? { action: 'exists', set_number: sn }
    : await addSet(sn, V.acquisitionQuantity(eingabe.quantity ?? 1), besitzerId, null,
                   V.optionalPrice(eingabe.purchase_price, 'Kaufpreis'), zustand,
                   // Marcos Befund vom 24.09.: „Wenn ich etwas aus der Merkliste
                   // in die Galerie aufnehme, kann ich den Lagerort nicht
                   // setzen." Er reicht einfach durch — addSet() setzt ihn ueber
                   // dieselbe Funktion wie der Detaildialog.
                   eingabe.storage == null ? null : String(eingabe.storage));

  // Geraeumt wird nach dem MERKPOSTEN-Zustand, nicht nach dem erfassten: Es geht
  // um die Zeile, die man erfuellt hat.
  await loescheMerkposten(besitzerId, sn, merkpostenZustand);
  await loescheAlarm(besitzerId, sn, merkpostenZustand);
  return ergebnis as { action: string; set_number: string };
}

/**
 * Die Merkliste EINES Kontos als CSV — für den ZIP-Export.
 * Ausführlich: docs/begruendungen/src/merkliste/merkliste.ts.md#buildmerklistecsv
 */
export async function buildMerklisteCsv(uid: number): Promise<string> {
  const rows = await db.all(
    `SELECT w.set_number,
            w.condition,
            TO_CHAR(w.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS created_at
       FROM wanted w
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC, w.set_number, w.condition`,
    [uid]);


  return toCsv(['set_number', 'condition', 'created_at'], rows);
}
