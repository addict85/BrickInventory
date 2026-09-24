/**
 * Die Merkliste — was man haben MÖCHTE, getrennt von dem, was man hat.
 *
 * ── Warum dieser Helfer und nicht Code in der Route ─────────────────────────
 *
 * Dieselbe Begründung wie bei utils/lagerort.ts: Die Merkliste wird von
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
 * Neu und gebraucht sind verschiedene Merkposten mit verschiedenen Schwellen.
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
export interface Merkposten {
  set_number: string;
  condition: string;
  created_at: string;
  /** Wem der Merkposten gehört — im Kontenbaum sieht man fremde mit. */
  user_id: number;
  /**
   * Der Marktpreis im Zustand DIESES Merkpostens — null, solange keiner
   * bekannt ist.
   *
   * ── Marcos Vorgabe vom 24.09. ────────────────────────────────────────────
   *
   * „Bitte in der Tabelle der Merkliste der Button In die Galerie aufnehme
   *  entfernen und dafuer den Marktpreis anzeigen."
   *
   * ── Warum aus dem CACHE und nicht frisch geholt ──────────────────────────
   *
   * Ein Abruf je Zeile waere bei zwei Dutzend Merkposten ein Dutzend
   * BrickLink-Anfragen beim Oeffnen des Reiters — und die Liste wartete
   * darauf. Sie ist aber ohnehin da: jobs/priceJob.ts frischt die Preise der
   * Merkposten taeglich auf (die Begruendung steht dort ausdruecklich —
   * „ausgerechnet fuer einen Merkposten ist die Preisentwicklung das
   * Wichtigste"). Ein LEFT JOIN kostet nichts und liefert genau den Stand,
   * den der Job hinterlegt hat.
   *
   * Kein Preis heisst hier „noch keiner im Cache", nicht „wertlos" — die
   * Oberflaechen zeigen dafuer einen Strich.
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
   *
   * ── Warum das hier dazugehoert ──────────────────────────────────────────
   *
   * Marcos Befund: „Die Bilder in der Merkliste werden nicht geladen …
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
   * Der Preisalarm zu GENAU diesem Merkposten — oder null.
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
   * ── Warum sie AM MERKPOSTEN haengt und nicht am Katalog ────────────────────
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
   * waere leer, und dann gaebe es den Merkposten nicht.
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
 *
 * ON CONFLICT statt vorher fragen: Zwei Geräte, die denselben Merkposten
 * gleichzeitig eintragen, sollen nicht einer davon einen Fehler sehen. Das
 * Ergebnis sagt, ob es neu war — die Oberfläche meldet sonst „ist schon
 * drauf" statt „hinzugefügt".
 *
 * DO UPDATE SET condition = wanted.condition ist eine Zuweisung ohne
 * Wirkung, und sie steht mit Absicht da: Ohne UPDATE-Zweig liefert
 * RETURNING für eine bestehende Zeile gar nichts, und `war_neu` wäre dann
 * nicht false, sondern unbekannt. Hier stand vorher die Notiz; seit sie
 * ausgebaut ist (Migration 0022), gibt es nichts mehr zu ändern.
 */
export async function legeMerkpostenAn(
  userId: number, setNumber: string, condition: unknown,
): Promise<{ merkposten: Merkposten | null; war_neu: boolean }> {
  const sn = sanitizeSetNumber(setNumber);
  const c  = await zustandOder(condition, userId);
  const r = await db.get(
    `INSERT INTO wanted (user_id, set_number, condition)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET condition = wanted.condition
     RETURNING (xmax = 0) AS war_neu`,
    [userId, sn, c]);
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
 *
 * ── Marcos Befund ──────────────────────────────────────────────────────────
 *
 * „Auf dem Detail-Dialog der Merkliste kann der Inhaber nicht geändert
 * werden. Auch in der Android-App nicht."
 *
 * Er hat recht: Beim ERFASSEN liess sich das Konto wählen, danach nie wieder.
 * Wer sich vertippt hat, musste löschen und neu anlegen — und verlor dabei
 * den Preisalarm.
 *
 * ── Warum UPDATE und nicht löschen plus neu anlegen ────────────────────────
 *
 * Weil das Aufnahmedatum bleiben soll. „Auf der Liste seit" ist die einzige
 * Angabe, die ein Merkposten über sich selbst trägt; ein Neuanlegen setzte sie auf
 * heute, und niemand sähe, dass es dieselbe Sache ist.
 *
 * ── Was mit dem Preisalarm geschieht ───────────────────────────────────────
 *
 * Er zieht mit. Der Alarm gehört zum Merkposten (derselbe Schlüssel: Konto, Set,
 * Zustand) — bliebe er zurück, meldete er dem alten Konto einen Preis für
 * etwas, das es nicht mehr auf der Liste hat.
 *
 * ── Und wenn das Zielkonto den Merkposten schon hat ────────────────────────────
 *
 * Dann ist das Ziel erreicht, und die Quelle verschwindet — samt ihrem Alarm.
 * Die Schwelle des ZIELS bleibt stehen: Sie ist die jüngere Aussage über das
 * Konto, dem der Merkposten jetzt gehört. Das Ergebnis sagt es (`zusammengefuehrt`),
 * damit die Oberfläche nicht „verschoben" meldet, wo etwas verschwunden ist.
 *
 * @returns verschoben=false heisst: Es gab nichts zu verschieben (kein Merkposten
 *          unter dem alten Konto, oder altes und neues Konto sind dasselbe).
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
 *
 * ── Warum nicht dieselbe Tabelle wie bei den Sets ──────────────────────────
 *
 * Die Namen sind absichtlich dieselben wie in SET_SORTS (utils/handlers/sets.ts)
 * — beide Oberflaechen beschriften sie mit denselben Texten, und wer die
 * Galerie kennt, erwartet in der Merkliste dieselbe Auswahl. Die AUSDRUECKE
 * koennen es nicht sein: Dort steht `s.added_at`, hier `w.created_at`; dort
 * ist der Preis der KAUFPREIS aus den Erfassungen, hier der MARKTPREIS aus
 * dem Cache, denn gekauft hat man einen Merkposten gerade nicht.
 *
 * qty_desc/qty_asc fehlen mit Absicht: Ein Merkposten hat keine Anzahl.
 *
 * NULLS LAST ueberall dort, wo der Wert fehlen kann: Ein Set, das rb_sets
 * nicht kennt, hat weder Namen noch Jahr, und ein Merkposten ohne Preis im
 * Cache keinen Marktpreis.
 *
 * GEMESSEN (test/merkliste-filter-db.test.js, Gegenprobe d): Wirkung hat die
 * Angabe nur bei DESC — dort ist NULLS FIRST die Vorgabe von Postgres, und
 * ohne sie stuenden die Zeilen OHNE Preis ganz oben. Bei ASC ist NULLS LAST
 * ohnehin die Vorgabe; dort steht sie nur, damit die Tabelle sich in jeder
 * Zeile gleich liest. Das ist eine Messung und keine Vermutung: Die erste
 * Gegenprobe strich sie bei name_asc und blieb gruen.
 *
 * Zweiter Sortierschluessel ueberall: Dasselbe Set steht zweimal da (neu und
 * gebraucht) und im Kontenbaum bei mehreren Konten. Ohne ihn legt Postgres
 * die Reihenfolge dieser Zeilen nicht fest, und sie sprang bei jedem Laden.
 */
const MERK_SORTS = {
  added_desc: 'w.created_at DESC',
  added_asc:  'w.created_at ASC',
  name_asc:   'rb.name ASC NULLS LAST',
  num_asc:    'w.set_number ASC',
  year_desc:  'rb.year DESC NULLS LAST',
  price_desc: 'pc.avg_price DESC NULLS LAST',
  price_asc:  'pc.avg_price ASC NULLS LAST',
};

/**
 * Suche, Zustand und Sortierung — Marcos Vorgabe „in der Merkliste noch einen
 * Filter analog den Sets einbauen inkl. Inhaber".
 *
 * Der INHABER steht nicht in diesem Typ: Er ist das Blickfeld und kommt als
 * `userIds` herein, genau wie in jeder anderen Liste dieses Baums. Die Route
 * uebersetzt `accounts=` mit scopeIds() dorthin — eine zweite Stelle, die
 * Konten auswaehlt, waere die Doppelung, vor der utils/household.ts warnt.
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
 *
 * `userIds` und nicht `userId`: Marcos Festlegung ist, dass die Merkliste
 * dem Kontenbaum folgt wie alles andere — der Grossvater sieht die Merkposten
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
export async function merkpostenVon(
  userIds: number[], nurSet?: string, waehrung = 'EUR', filter?: MerkFilter,
): Promise<Merkposten[]> {
  if (!userIds?.length) return [];
  const params: unknown[] = [userIds];
  let wo = '';
  if (nurSet) { params.push(sanitizeSetNumber(nurSet)); wo += ` AND w.set_number = $${params.length}`; }

  // ── Die Suche trifft Nummer UND Namen ─────────────────────────────────────
  //
  // Dieselbe Erwartung wie in der Galerie: Wer „Falcon" tippt, sucht nicht
  // nach einer Nummer, und wer „75192" tippt, nicht nach einem Namen. Der Name
  // steht nicht in `wanted`, sondern kommt aus dem LEFT JOIN auf rb_sets
  // (siehe Migration 0021: keine zweite Kopie der Stammdaten) — ein Set, das
  // der Katalog nicht kennt, ist deshalb nur ueber seine Nummer zu finden.
  //
  // Die Platzhalter % stehen im WERT und nicht im SQL: So bleibt die Eingabe
  // ein Parameter. Ein zusammengesetztes ILIKE '%' || $n || '%' taete
  // dasselbe, waere aber eine zweite Schreibweise fuer denselben Gedanken.
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
        + ` OR rb.name ILIKE $${params.length} ESCAPE '\\')`;
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
            rb.name, rb.year, rb.theme_id, rb.num_parts,
            rb.set_img_url AS image_url,
            pa.richtung AS alarm_richtung, pa.schwelle AS alarm_schwelle,
            pa.ausgeloest AS alarm_ausgeloest,
            pc.avg_price AS marktpreis,
            EXISTS (SELECT 1 FROM sets s
                     WHERE s.user_id = ANY($1) AND s.set_number = w.set_number) AS owned
       FROM wanted w
       LEFT JOIN rb_sets rb ON rb.set_num = w.set_number
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
    params)
    // Wie beim Preisalarm: Ein Aufbau, der nur initSchema() gelaufen ist, hat
    // die Tabelle nicht (siehe die Begruendung in db/schema.sql). Eine leere
    // Liste ist dort die richtige Antwort, kein Fehler.
    .catch((e: unknown) => { meldeUndWeiter('merkliste:lesen', e); return []; });
  // Die Zahlenspalten kommen als Zeichenkette aus dem Treiber — dieselbe
  // Stelle, an der in diesem Baum schon einmal ein Vergleich still falsch
  // wurde (siehe utils/preisalarm.ts).
  type Zeile = Omit<Merkposten, 'year' | 'num_parts' | 'owned' | 'alarm' | 'preisvergleich_url'
                            | 'image_local' | 'marktpreis' | 'waehrung'> &
               { year: string | number | null; num_parts: string | number | null; owned: unknown;
                 alarm_richtung: string | null; alarm_schwelle: string | number | null;
                 alarm_ausgeloest: unknown; marktpreis: string | number | null };
  // ── Fehlt das Bild noch, wird es hier bestellt ───────────────────────────
  //
  // Marcos zweiter Befund: „Leider wird es auch nach ein paar Minuten noch
  // ueber den Proxy geladen. Scheint so, als wuerde der Pfad nicht dazu
  // fuehren, dass das Bild im Hintergrund heruntergeladen wird."
  //
  // Er hat recht, und der Grund steht im Proxy: Eine Notiz fuer den Bild-Job
  // entsteht dort NUR, wenn eine Vorschau angefragt wurde (routes/imgProxy.ts:
  // `if (wantThumb) { … } else notiere();`). Das Merkposten-Detail fragt die volle
  // Aufloesung — also keine Notiz, also kein Download, also auf Dauer der
  // Umweg ueber den Proxy.
  //
  // Ein Merkposten ist ein Set, das man NICHT besitzt: Niemand hat sein Bild je
  // heruntergeladen, und ohne diese Zeile geschieht es auch nie. Bewusst
  // anders als im Katalog, der „keine Bildarbeit aus der Liste" anstoesst —
  // der zeigt 25 000 fremde Sets, eine Merkliste ein paar Dutzend.
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
      // Number() ist hier ein NETZ, keine Umrechnung: NACHGEMESSEN liefert der
      // Treiber NUMERIC bereits als Zahl, weil db/database.ts:63 dafuer einen
      // Typ-Leser setzt (parseFloat). Die Zeile bleibt trotzdem stehen — der
      // Zeilentyp laesst `string | number` zu, und ohne sie haengt die
      // Richtigkeit des Feldes an einer Einstellung sechs Dateien weiter.
      //
      // Der erste Entwurf dieses Kommentars behauptete das Gegenteil („kommt
      // als Zeichenkette"). Die Gegenprobe hat es widerlegt: Number()
      // weggelassen — der Test blieb gruen.
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
 * Merkposten bei einem Fehler im Erfassen weg und das Set nicht da.
 */
export async function uebernimm(
  leserId: number, besitzerId: number, setNumber: string, condition: unknown,
  eingabe: { quantity?: unknown; purchase_price?: unknown; condition?: unknown;
             storage?: unknown } = {},
): Promise<{ action: string; set_number: string }> {
  const sn = sanitizeSetNumber(setNumber);

  // ── ZWEI Zustaende, und sie sind nicht dasselbe ──────────────────────────
  //
  // `condition` (Pfad) ist der Zustand des MERKPOSTENS — der Schluessel der
  // Zeile, die verschwindet. `eingabe.condition` ist der Zustand, in dem das
  // Set tatsaechlich ERFASST wird.
  //
  // Sie fallen auseinander, sobald jemand etwas anderes kauft, als er sich
  // gewuenscht hat: Merkposten „gebraucht", gefunden wurde ein neues. Dann muss
  // der gebrauchte Merkposten weg (den hat man erfuellt) und das Set als neu in
  // die Galerie (das hat man gekauft).
  //
  // Vorher gab es nur einen Wert fuer beides. Das war stillschweigend falsch:
  // In der Finanzansicht stuende die Erfassung in der falschen Gruppe —
  // dieselbe Verwechslung, die in addSet() schon einmal einen Gebrauchtpreis
  // als Neuzugang verbucht hat.
  const merkpostenZustand = await zustandOder(condition, besitzerId);
  const zustand = eingabe.condition == null
    ? merkpostenZustand
    : await zustandOder(eingabe.condition, besitzerId);

  // Schon im Blickfeld? Dann NICHT die Menge erhoehen — dieselbe Regel wie
  // beim Erfassen (utils/setAdd.ts), damit sie nicht davon abhaengt, ueber
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
