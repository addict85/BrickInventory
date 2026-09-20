/**
 * Die Wunschliste — was man haben MÖCHTE, getrennt von dem, was man hat.
 *
 * ── Warum dieser Helfer und nicht Code in der Route ─────────────────────────
 *
 * Dieselbe Begründung wie bei utils/lagerort.ts: Die Wunschliste wird von
 * beiden Oberflächen und über drei Erfassungswege bedient (Katalog-Detail,
 * Setnummer, Barcode). Stünden Normalisierung, Zustandsvorgabe und die
 * Übernahme in die Galerie in den Routen, gäbe es jede Regel mehrfach — und
 * in diesem Baum ist genau das schon mehrfach auseinandergelaufen.
 *
 * ── Die Übernahme ruft addSet() und baut nichts Eigenes ─────────────────────
 *
 * „Direkt in die Galerie übernehmen" heisst: dasselbe tun wie das Erfassen
 * einer Setnummer. utils/setService.ts:addSet() ist dafür die eine Wahrheit —
 * es bestimmt den Zustand über zustandFuerPreis(), holt den Marktpreis, legt
 * die Erfassungszeile an, hält die Bestandssperre und stösst die
 * Anreicherung an. Ein eigenes INSERT INTO sets hier wäre die zweite
 * Wahrheit und hätte von alldem nichts.
 *
 * ── Der Zustand steht im Schlüssel ──────────────────────────────────────────
 *
 * Neu und gebraucht sind verschiedene Wünsche mit verschiedenen Schwellen.
 * price_alerts führt den Zustand seit 0019 genauso; beide Tabellen treffen
 * sich über (user_id, set_number, condition), ohne dass eine die andere
 * kennen muss.
 */
import * as db from '../db/database';
import { addSet, sanitizeSetNumber } from './setService';
import { findSetInScope } from './setAdd';
import { loescheAlarm } from './preisalarm';
import * as V from './validate';
import { nutzerStandardZustand } from './settings';
import { meldeUndWeiter } from './httpError';
import { fuerSet } from './preisvergleich';
import { resolveIfExists } from './images';

/** Ein Eintrag, wie ihn beide Oberflächen sehen. */
export interface Wunsch {
  set_number: string;
  condition: string;
  created_at: string;
  /** Wem der Wunsch gehört — im Kontenbaum sieht man fremde mit. */
  user_id: number;
  /** Aus rb_sets, nicht mitgespeichert (siehe Migration 0021). */
  name: string | null;
  year: number | null;
  theme_id: number | null;
  num_parts: number | null;
  image_url: string | null;
  /**
   * Die lokal abgelegte Bilddatei — wenn es sie gibt.
   *
   * ── Warum das hier dazugehoert ──────────────────────────────────────────
   *
   * Marcos Befund: „Die Bilder in der Wunschliste werden nicht geladen …
   * anscheinend wird direkt das CDN aufgerufen." Genau so war es, und die
   * Sicherheitsrichtlinie der Seite (img-src 'self' data: blob:) hat es
   * geblockt — richtigerweise.
   *
   * Jede andere Liste im Baum fuehrt image_local MIT und zieht es dem
   * CDN-Pfad vor: Die Datei liegt schon auf der Platte, und eine
   * Proxy-Anfrage waere ein Umweg ueber das Netz fuer etwas, das danebenliegt.
   * Der Katalog macht es mit derselben Zeile (routes/api_v1/catalog.ts).
   *
   * null heisst „noch nicht heruntergeladen" — dann laedt die Oberflaeche
   * ueber den Bild-Proxy, der die Datei nebenbei anlegt.
   */
  image_local: string | null;
  /** Liegt das Set schon in der Galerie eines Kontos im Blickfeld? */
  owned: boolean;
  /**
   * Der Preisalarm zu GENAU diesem Wunsch — oder null.
   *
   * Er steht in price_alerts und nicht hier (siehe 0021); beide Tabellen
   * teilen sich den Schluessel (user_id, set_number, condition). Er reist
   * trotzdem mit: Wer einen Alarm setzt und ihn danach nirgends mehr sieht,
   * hat ihn verloren. Ein eigener Aufruf je Zeile waere N+1 fuer eine Liste,
   * die auch hundert Eintraege haben kann.
   */
  alarm: { richtung: string; schwelle: number; ausgeloest: boolean } | null;
  /**
   * Preisvergleich — die Adresse, die der Knopf im Detail oeffnet.
   *
   * ── Warum sie AM WUNSCH haengt und nicht am Katalog ────────────────────
   *
   * Beide Oberflaechen holten sie bisher aus /catalog/sets/:nr, zusammen mit
   * Thema und Teilezahl. Damit haengt ein Knopf, der nur die Setnummer
   * braucht, an einer zweiten Anfrage: Ist das Set in rb_sets nicht
   * vorhanden (Katalog noch nicht geladen, Set zu neu, Eigenbau), antwortet
   * die Route 404 — und der Knopf bleibt aus, obwohl die Adresse aus der
   * Nummer allein zu bilden gewesen waere.
   *
   * Sie reist deshalb mit der Liste mit. Der Name kommt aus rb_sets, wenn es
   * ihn gibt; fehlt er, sucht die Adresse eben nur nach der Nummer
   * (utils/preisvergleich.ts). Immer gesetzt, nie leer — ausser die Nummer
   * waere leer, und dann gaebe es den Wunsch nicht.
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
 * Einen Wunsch anlegen.
 *
 * ON CONFLICT statt vorher fragen: Zwei Geräte, die denselben Wunsch
 * gleichzeitig eintragen, sollen nicht einer davon einen Fehler sehen. Das
 * Ergebnis sagt, ob es neu war — die Oberfläche meldet sonst „ist schon
 * drauf" statt „hinzugefügt".
 *
 * DO UPDATE SET condition = wishlist.condition ist eine Zuweisung ohne
 * Wirkung, und sie steht mit Absicht da: Ohne UPDATE-Zweig liefert
 * RETURNING für eine bestehende Zeile gar nichts, und `war_neu` wäre dann
 * nicht false, sondern unbekannt. Hier stand vorher die Notiz; seit sie
 * ausgebaut ist (Migration 0022), gibt es nichts mehr zu ändern.
 */
export async function legeWunschAn(
  userId: number, setNumber: string, condition: unknown,
): Promise<{ wunsch: Wunsch | null; war_neu: boolean }> {
  const sn = sanitizeSetNumber(setNumber);
  const c  = await zustandOder(condition, userId);
  const r = await db.get(
    `INSERT INTO wishlist (user_id, set_number, condition)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET condition = wishlist.condition
     RETURNING (xmax = 0) AS war_neu`,
    [userId, sn, c]);
  const liste = await wuenscheVon([userId], sn);
  return { wunsch: liste.find(w => w.condition === c) ?? null, war_neu: !!r?.war_neu };
}

/** Wunsch entfernen. Kein Fehler, wenn es keinen gab — das Ziel ist erreicht. */
export async function loescheWunsch(userId: number, setNumber: string, condition: unknown): Promise<number> {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await db.run(
    'DELETE FROM wishlist WHERE user_id=$1 AND set_number=$2 AND condition=$3',
    [userId, sanitizeSetNumber(setNumber), c]);
  return r.changes ?? 0;
}

/**
 * Die Wünsche eines Blickfelds.
 *
 * `userIds` und nicht `userId`: Marcos Festlegung ist, dass die Wunschliste
 * dem Kontenbaum folgt wie alles andere — der Grossvater sieht die Wünsche
 * der Enkel. Das ist hier nicht nur konsequent, sondern der Zweck: Wer ein
 * Geschenk sucht, schaut genau dort nach.
 *
 * Der LEFT JOIN auf rb_sets liefert die Anzeige (siehe Migration 0021: keine
 * zweite Kopie der Stammdaten). Ein Set, das der Katalog nicht kennt, kommt
 * mit NULL-Namen zurück und zeigt in der Oberfläche seine Nummer.
 *
 * `owned` beantwortet die Frage, die in der Liste sofort aufkommt: „Habe ich
 * das inzwischen?" — es prüft dasselbe Blickfeld, nicht nur das eigene Konto.
 */
export async function wuenscheVon(userIds: number[], nurSet?: string): Promise<Wunsch[]> {
  if (!userIds?.length) return [];
  const params: unknown[] = [userIds];
  let filter = '';
  if (nurSet) { params.push(sanitizeSetNumber(nurSet)); filter = ' AND w.set_number = $2'; }
  const rows = await db.all(
    `SELECT w.set_number, w.condition, w.created_at, w.user_id,
            rb.name, rb.year, rb.theme_id, rb.num_parts,
            rb.set_img_url AS image_url,
            pa.richtung AS alarm_richtung, pa.schwelle AS alarm_schwelle,
            pa.ausgeloest AS alarm_ausgeloest,
            EXISTS (SELECT 1 FROM sets s
                     WHERE s.user_id = ANY($1) AND s.set_number = w.set_number) AS owned
       FROM wishlist w
       LEFT JOIN rb_sets rb ON rb.set_num = w.set_number
       LEFT JOIN price_alerts pa ON pa.user_id = w.user_id
                                AND pa.set_number = w.set_number
                                AND pa.condition = w.condition
      WHERE w.user_id = ANY($1)${filter}
      ORDER BY w.created_at DESC, w.set_number, w.condition`,
    params)
    // Wie beim Preisalarm: Ein Aufbau, der nur initSchema() gelaufen ist, hat
    // die Tabelle nicht (siehe die Begruendung in db/schema.sql). Eine leere
    // Liste ist dort die richtige Antwort, kein Fehler.
    .catch((e: unknown) => { meldeUndWeiter('wunschliste:lesen', e); return []; });
  // Die Zahlenspalten kommen als Zeichenkette aus dem Treiber — dieselbe
  // Stelle, an der in diesem Baum schon einmal ein Vergleich still falsch
  // wurde (siehe utils/preisalarm.ts).
  type Zeile = Omit<Wunsch, 'year' | 'num_parts' | 'owned' | 'alarm' | 'preisvergleich_url' | 'image_local'> &
               { year: string | number | null; num_parts: string | number | null; owned: unknown;
                 alarm_richtung: string | null; alarm_schwelle: string | number | null;
                 alarm_ausgeloest: unknown };
  // ── Fehlt das Bild noch, wird es hier bestellt ───────────────────────────
  //
  // Marcos zweiter Befund: „Leider wird es auch nach ein paar Minuten noch
  // ueber den Proxy geladen. Scheint so, als wuerde der Pfad nicht dazu
  // fuehren, dass das Bild im Hintergrund heruntergeladen wird."
  //
  // Er hat recht, und der Grund steht im Proxy: Eine Notiz fuer den Bild-Job
  // entsteht dort NUR, wenn eine Vorschau angefragt wurde (routes/imgProxy.ts:
  // `if (wantThumb) { … } else notiere();`). Das Wunsch-Detail fragt die volle
  // Aufloesung — also keine Notiz, also kein Download, also auf Dauer der
  // Umweg ueber den Proxy.
  //
  // Ein Wunsch ist ein Set, das man NICHT besitzt: Niemand hat sein Bild je
  // heruntergeladen, und ohne diese Zeile geschieht es auch nie. Bewusst
  // anders als im Katalog, der „keine Bildarbeit aus der Liste" anstoesst —
  // der zeigt 25 000 fremde Sets, eine Wunschliste ein paar Dutzend.
  //
  // merkeGebraucht() ist gepuffert und dedupliziert (ON CONFLICT DO NOTHING,
  // Wegschreiben alle zehn Sekunden); ein erneuter Aufruf fuer dasselbe Bild
  // kostet nichts. Spaetes require wie in routes/api_v1/catalog.ts:
  // utils/ -> jobs/ -> utils/ waere am Dateikopf ein Ladezyklus.
  const { merkeGebraucht } = require('../jobs/imageQueue');

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
    if (!lokal && r.image_url) merkeGebraucht(String(r.image_url), String(r.set_number));
    return {
      ...r,
      year:      r.year      == null ? null : Number(r.year),
      num_parts: r.num_parts == null ? null : Number(r.num_parts),
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
 * Einen Wunsch in die Galerie uebernehmen.
 *
 * ── Warum addSet() und kein eigenes INSERT ─────────────────────────────────
 *
 * „Direkt in die Galerie uebernehmen" ist dasselbe wie eine Setnummer
 * erfassen. addSet() ist dafuer die eine Wahrheit: Zustand ueber
 * zustandFuerPreis(), Marktpreis, Erfassungszeile, Bestandssperre,
 * Anreicherung. Ein eigenes INSERT INTO sets haette von alldem nichts.
 *
 * ── Warum das hier steht und nicht in der Route ────────────────────────────
 *
 * Weil es eine Regel ist und keine Vermittlung. In der Route liesse sie sich
 * nur ueber HTTP pruefen, und die App braucht sie genauso wie die Webapp.
 *
 * ── Was danach verschwindet ────────────────────────────────────────────────
 *
 * Eintrag UND Preisalarm, nach Marcos Festlegung: Wer das Set hat, will in
 * der Regel nicht weiter auf einen Preis warten — und die Set-Detailansicht
 * hat ein Alarmfeld, der Weg zurueck ist einen Griff weit.
 *
 * Geloescht wird ERST NACH dem erfolgreichen addSet(). Andersherum waere der
 * Wunsch bei einem Fehler im Erfassen weg und das Set nicht da.
 */
export async function uebernimm(
  leserId: number, besitzerId: number, setNumber: string, condition: unknown,
  eingabe: { quantity?: unknown; purchase_price?: unknown; condition?: unknown } = {},
): Promise<{ action: string; set_number: string }> {
  const sn = sanitizeSetNumber(setNumber);

  // ── ZWEI Zustaende, und sie sind nicht dasselbe ──────────────────────────
  //
  // `condition` (Pfad) ist der Zustand des WUNSCHES — der Schluessel der
  // Zeile, die verschwindet. `eingabe.condition` ist der Zustand, in dem das
  // Set tatsaechlich ERFASST wird.
  //
  // Sie fallen auseinander, sobald jemand etwas anderes kauft, als er sich
  // gewuenscht hat: Wunsch „gebraucht", gefunden wurde ein neues. Dann muss
  // der gebrauchte Wunsch weg (den hat man erfuellt) und das Set als neu in
  // die Galerie (das hat man gekauft).
  //
  // Vorher gab es nur einen Wert fuer beides. Das war stillschweigend falsch:
  // In der Finanzansicht stuende die Erfassung in der falschen Gruppe —
  // dieselbe Verwechslung, die in addSet() schon einmal einen Gebrauchtpreis
  // als Neuzugang verbucht hat.
  const wunschZustand = await zustandOder(condition, besitzerId);
  const zustand = eingabe.condition == null
    ? wunschZustand
    : await zustandOder(eingabe.condition, besitzerId);

  // Schon im Blickfeld? Dann NICHT die Menge erhoehen — dieselbe Regel wie
  // beim Erfassen (utils/setAdd.ts), damit sie nicht davon abhaengt, ueber
  // welchen der vier Wege jemand kommt. Der Wunsch ist trotzdem erfuellt und
  // verschwindet; sonst bliebe er fuer ein Set stehen, das man hat.
  const vorhanden = await findSetInScope(leserId, sn);
  const ergebnis = vorhanden
    ? { action: 'exists', set_number: sn }
    : await addSet(sn, V.acquisitionQuantity(eingabe.quantity ?? 1), besitzerId, null,
                   V.optionalPrice(eingabe.purchase_price, 'Kaufpreis'), zustand);

  // Geraeumt wird nach dem WUNSCH-Zustand, nicht nach dem erfassten: Es geht
  // um die Zeile, die man erfuellt hat.
  await loescheWunsch(besitzerId, sn, wunschZustand);
  await loescheAlarm(besitzerId, sn, wunschZustand);
  return ergebnis as { action: string; set_number: string };
}
