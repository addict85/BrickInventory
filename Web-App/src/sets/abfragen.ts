import { resolveOne } from '../katalog/bricklinkLink';
import { meldeUndWeiter, meldeUndLiefere } from '../infra/httpError';
import { fuerSet } from '../finanzen/preisvergleich';
import * as db from '../../db/database';
import * as repo from './repository/sets';
import type { DbSchnittstelle } from '../../db/database';
import { resolveImageLocal } from '../katalog/bilder/images';
import { asIds } from '../haushalt/haushalt';
import { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions, withOwners } from '../bestand/gemeinsam';
import { anleitungenZuSet, anleitungenZusammenlegen } from '../katalog/instructions';
import { legeInPapierkorb } from '../bestand/papierkorb';

/**
 * Leseabfragen für Sets, samt der Ableitung des Zustands aus den Erfassungen.
 * Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#set-sorts
 */


/**
 * Ein Blickfeld: entweder eine einzelne Konto-ID oder die Liste aus
 * scopeIds() (src/haushalt/haushalt.ts). asIds() normalisiert beides auf eine Liste.
 *
 * Der Typ macht die Casts `asIds(userId)` ueberfluessig — die standen
 * nur da, weil der Parameter gar keinen Typ hatte.
 */
import type { BlickfeldEingabe as Blickfeld } from '../haushalt/haushalt';

/**
 * Filtern und Sortieren auf dem Server, damit sie mit seitenweisem Laden
 * zusammengehen. Ohne page_size alles — so ruft die Android-App.
 */
export async function getSets(userId: Blickfeld, query: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Explizite Spaltenliste statt SELECT *: id/user_id/updated_at
  // werden weder von der Webapp noch von der Android-App gelesen — sie haben
  // den JSON-Payload der /sets-Antwort nur unnötig aufgebläht.
  // Mit "s." qualifiziert: die angehängte Aggregat-Subquery führt set_number …
  // Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#getsets-set-cols
  const { search, theme, sort, page = 1, page_size = null } = query;
  const size = page_size ? clampPageSize(page_size, 60) : null;
  const { sets, countRow, themeRows } = await repo.setListe(uids, {
    search, theme, sort, storage: query.storage,
    seite: size ? { groesse: size, versatz: (Math.max(1, parseInt(page) || 1) - 1) * size } : null,
    themen: !!page_size && parseInt(page) <= 1,
  });

  // Anleitungen nur für die Setnummern DIESER Seite. Ohne Sets auf der Seite
  // (leere Suche, letzte Seite) entfallen beide Abfragen ganz.
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
    // Angezeigter Zustand als Aggregat: sobald mindestens eine Kaufpreis-
    // Erfassung "Gebraucht" (U) ist, gilt das Set als gebraucht. Sind
    // Erfassungen vorhanden, aber alle "Neu", wird "Neu" angezeigt — der
    // gespeicherte sets.condition-Wert wird NICHT mehr als Fallback benutzt,
    // solange Erfassungen existieren (er kann nach Löschen/Reduzieren veraltet
    // sein). Nur ganz ohne Erfassungen zählt die gespeicherte Spalte.
    condition: conditionFromAcquisitions(s.acq_count, s.used_count),
    // Alle vorkommenden Zustände — die Kachel zeigt je eine Plakette.
    conditions: conditionsFromAcquisitions(s.acq_count, s.used_count),
    avg_purchase_price: s.avg_purchase_price != null ? parseFloat(s.avg_purchase_price) : null,
    image_local: resolveImageLocal(s.image_local),
    // Besitzer nur im Haushalt: Im Einzelkonto wäre die Angabe „gehört mir“ an
    // jeder Kachel nur Rauschen.
    // Im Haushalt IMMER dabei, auch leer: array_agg liefert NULL, wenn der
    // FILTER alles ausschliesst (ein Set, das niemand mehr in Menge > 0
    // besitzt). withOwners() unten macht daraus eine leere Plakettenliste —
    // wie die frueher hier stehende Schleife.
    ...(uids.length > 1 ? { owner_ids: (s.owner_ids || []).map((n: any) => parseInt(n)) } : {}),
    instructions: anleitungenZusammenlegen(
      sharedBySet.get(s.set_number) || [],
      userBySet.get(s.set_number) || [],
    ),
  }));

  // Namen zu den Besitzer-IDs steht in withOwners() (handlers/shared.ts) —
  // eine Abfrage fuer die ganze Seite, nicht eine je Zeile. Hier stand
  // dieselbe Aufloesung noch einmal ausformuliert; als die Set-Figuren
  // dieselbe Plakette bekamen, waere daraus eine dritte Kopie geworden.
  const mitBesitzern = await withOwners(uids, mapped);

  // Rückgabeform ist jetzt ein Objekt statt eines nackten Arrays, damit die
  // Gesamtzahl für den Endlos-Scroll mitkommt. Ohne Paginierung entspricht
  // total der Länge der Liste — die Aufrufer bleiben dadurch beide gleich.
  return {
    sets: mitBesitzern,
    total: countRow ? parseInt(countRow.c) : mapped.length,
    ...(themeRows ? { themes: themeRows.map(r => r.theme) } : {}),
  };
}

/**
 * Zustands-Aggregat eines Sets aus seinen Erfassungen.
 * Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#getsetconditionaggregate
 */
export async function getSetConditionAggregate(userId: Blickfeld, setNumber: string) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const acq = await repo.setErfassungsKennzahlen(uids, setNumber);
  const acqCount  = parseInt(acq?.acq_count) || 0;
  const usedCount = parseInt(acq?.used_count) || 0;
  return {
    condition: conditionFromAcquisitions(acqCount, usedCount),
    // Dieselben Felder wie in getSets() — die Schreib-Endpunkte liefern das
    // Aggregat mit, und die Kachel wird damit ohne Neuladen aktualisiert.
    // Fehlte conditions hier, verlöre sie nach dem Speichern die zweite
    // Plakette bis zum nächsten vollständigen Laden.
    conditions: conditionsFromAcquisitions(acqCount, usedCount),
    acq_count: acqCount,
    used_count: usedCount,
    max_purchase_price: acq?.max_purchase_price ?? null,
    avg_purchase_price: acq?.avg_purchase_price != null ? parseFloat(acq.avg_purchase_price) : null,
  };
}

/**
 * Hängt das neu berechnete Zustands-Aggregat an eine Antwort.
 * Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#withsetaggregate
 */
export async function withSetAggregate<T extends object>(userId: Blickfeld, setNumber: string, payload: T) {
  const uids = asIds(userId);
  // Die Abfrage auf sets.condition, die hier stand, ist mit Migration 0032
  // entfallen — samt der Spalte. Das Aggregat rechnet aus den Erfassungen.
  const agg = await getSetConditionAggregate(uids, setNumber).catch(meldeUndLiefere('sets-handler:getSetConditionAggregate', null));
  return agg ? { ...payload, set: { set_number: setNumber, ...agg } } : payload;
}

export async function getSet(userId: Blickfeld, setNumber: string) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const [set, shared, uploaded] = await Promise.all([
    // Die eigene Zeile gewinnt für die übrigen Felder — sie beschreibt das
    // eigene Exemplar (Zustand, Kaufpreis). Die MENGE dagegen kommt aus der
    // Summe über alle Konten im Blickfeld.
    //  Der Lagerort muss AUSDRÜCKLICH dastehen
    // Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#getset
    repo.setDetailZeile(uids, setNumber, uids[0]),
    anleitungenZuSet(setNumber),
    repo.eigeneAnleitungenDesSets(uids, setNumber),
  ]);
  if (!set) return null;
  // Aggregat inkl. acq_count/used_count/max_purchase_price — dieselben Felder
  // wie in getSets(). Vorher fehlten sie hier, weshalb ein Client die
  // Listen-Kachel nicht einfach mit dem Detail-Objekt überschreiben konnte,
  // ohne genau diese Werte zu verlieren.
  const agg = await getSetConditionAggregate(uids, setNumber);
  // Zwei Kaufadressen, vom Server aufgeloest
  // Der Preisvergleich kommt aus demselben Grund von hier: Bisher stand seine
  // Adresse an genau einer Stelle (dem Vergleichsbildschirm der App); vier
  // Stellen daraus zu machen waere der Anfang von vier Wahrheiten.
  // Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#getset-2
  const [bricklink, preisvergleich] = await Promise.all([
    resolveOne(setNumber).catch((e: unknown) => {
      meldeUndWeiter('setdetail:bricklink', e);
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

/**
 * Die Zeilen, die zu EINEM Set-Exemplar eines Kontos gehören.
 * Ausführlich: docs/begruendungen/src/sets/abfragen.ts.md#deletesetrows
 */
export async function deleteSetRows(tx: DbSchnittstelle, uids: number[], setNumber: string) {
  await repo.entferneSetZeilen(tx, uids, setNumber);
}

export async function deleteSet(userId: Blickfeld, setNumber: string) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Atomar: vorher waren das vier sequenzielle DELETEs ohne Transaktion —
  // bricht eins davon ab (Statement-Timeout, Verbindungsverlust), bleiben
  // Teile und Minifiguren ohne zugehöriges Set in der DB zurück und tauchen
  // in Teileliste und Finanzsummen weiter auf.
  return db.transaction(async (tx) => {
    const besitzer = await repo.besitzerDesSets(tx, uids, setNumber);
    if (!besitzer.length) return false;
    // Ein Eintrag je Konto: Wiederhergestellt wird in das Konto, dem es gehörte.
    const papierkorb: number[] = [];
    for (const b of besitzer) {
      const id = await legeInPapierkorb(tx, 'set', b.user_id, setNumber);
      if (id !== null) papierkorb.push(id);
    }
    await deleteSetRows(tx, uids, setNumber);
    return papierkorb;
  });
}

