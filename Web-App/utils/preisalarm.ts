/**
 * Preisalarm — sag Bescheid, wenn ein Set eine Schwelle reisst.
 *
 * ── Warum es diesen Helfer gibt ─────────────────────────────────────────────
 *
 * Die Zahl, auf die es ankommt, wird ohnehin geholt: Der Preislauf
 * (jobs/priceJob.ts) fragt die Marktpreise regelmässig ab und schreibt sie in
 * price_cache. Es fehlte nur der Schritt danach — nachsehen, ob jemand darauf
 * gewartet hat.
 *
 * Diese Datei ist ein BLATT: Sie liest die Preise, entscheidet und verschickt.
 * Sie kennt weder Routen noch den Job, der sie aufruft — nur db, mailer und
 * fehlerTexte. Damit lässt sie sich auch ohne laufenden Job prüfen, und der
 * Job bleibt ein Job.
 *
 * ── Was hier ABSICHTLICH nicht steht ────────────────────────────────────────
 *
 * Kein Blickfeld, kein Haushalt. Ein Alarm gehört genau EINEM Konto: Wer eine
 * Schwelle setzt, will selbst benachrichtigt werden, und das Elternkonto hat
 * nichts davon, die Wünsche seiner Kinder per Mail zu bekommen. Das ist der
 * einzige Ort im Projekt, an dem `user_id = $1` steht, ohne dass es ein
 * Versehen ist — deshalb steht es hier auch begründet.
 */
import * as db from '../db/database';
import { scopeIds } from './household';
import { fehlerWerfen } from './fehlerTexte';

/**
 * Eine Alarmzeile samt Empfänger — das, was pruefeSet() aus der Datenbank
 * bekommt.
 *
 * Ausgeschrieben statt `any`: Hier stehen ein Geldbetrag, eine Richtung und
 * eine Mailadresse nebeneinander, und ein Vertauschen wäre an keiner Stelle
 * sichtbar. `schwelle` ist ausdrücklich `string | number`, weil der
 * Postgres-Treiber numeric als Zeichenkette liefert — genau deshalb steht
 * unten parseFloat und nicht Number().
 */
interface AlarmZeile {
  user_id: number;
  set_number: string;
  condition: string;
  richtung: Richtung;
  schwelle: string | number;
  currency_code: string;
  ausgeloest: boolean;
  email: string | null;
  username: string;
  sprache: string;
}

/** 'unter' = melden beim Unterschreiten, 'ueber' = beim Überschreiten. */
export type Richtung = 'unter' | 'ueber';

export interface Preisalarm {
  set_number: string;
  condition: string;
  richtung: Richtung;
  schwelle: number;
  currency_code: string;
  ausgeloest: boolean;
  zuletzt_am: string | null;
  zuletzt_preis: number | null;
}

/** Die beiden Zustände, die der ganze Baum kennt (N = neu, U = gebraucht). */
const ZUSTAENDE = new Set(['N', 'U']);

function pruefeEingabe(richtung: unknown, schwelle: unknown, condition: unknown) {
  const r = String(richtung ?? '');
  if (r !== 'unter' && r !== 'ueber') fehlerWerfen('alarm_richtung_ungueltig', 400);
  const s = Number(schwelle);
  // Number.isFinite fängt auch NaN aus einer leeren Eingabe — `> 0` allein
  // täte das nicht, denn NaN > 0 ist false und ergäbe dieselbe Meldung für
  // zwei verschiedene Fehler.
  if (!Number.isFinite(s) || s <= 0) fehlerWerfen('alarm_schwelle_ungueltig', 400);
  const c = String(condition ?? 'N').toUpperCase();
  if (!ZUSTAENDE.has(c)) fehlerWerfen('alarm_zustand_ungueltig', 400);
  return { richtung: r as Richtung, schwelle: s, condition: c };
}

/**
 * Alarm setzen oder ändern.
 *
 * Ein Konto hat je Set und Zustand höchstens EINEN Alarm (Primärschlüssel).
 * Zwei Schwellen in dieselbe Richtung wären ohnehin eine davon zu viel, und
 * „unter 200 UND über 400" ist eine Frage, die noch niemand gestellt hat —
 * käme sie, wäre sie ein zweiter Datensatz, nicht ein zweites Feld.
 *
 * Der Merker `ausgeloest` wird beim Ändern ZURÜCKGESETZT: Eine neue Schwelle
 * ist eine neue Frage, und die soll beantwortet werden, auch wenn die alte
 * schon einmal gemeldet hat.
 */
export async function setzeAlarm(
  userId: number, setNumber: string, waehrung: string,
  eingabe: { richtung?: unknown; schwelle?: unknown; condition?: unknown },
): Promise<Preisalarm> {
  const { richtung, schwelle, condition } =
    pruefeEingabe(eingabe.richtung, eingabe.schwelle, eingabe.condition);
  await db.run(
    `INSERT INTO price_alerts (user_id, set_number, condition, richtung, schwelle, currency_code)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET richtung = $4, schwelle = $5, currency_code = $6,
            ausgeloest = FALSE`,
    [userId, setNumber, condition, richtung, schwelle, waehrung]);
  const alarme = await alarmeFuer(userId, setNumber);
  return alarme.find(a => a.condition === condition)!;
}

/** Alarm entfernen. Kein Fehler, wenn es keinen gab — der Wunsch ist erfüllt. */
export async function loescheAlarm(userId: number, setNumber: string, condition: string) {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await db.run(
    'DELETE FROM price_alerts WHERE user_id=$1 AND set_number=$2 AND condition=$3',
    [userId, setNumber, c]);
  return r.changes ?? 0;
}

/** Die Alarme EINES Kontos zu einem Set (höchstens zwei: N und U). */
export async function alarmeFuer(userId: number, setNumber: string): Promise<Preisalarm[]> {
  const rows = await db.all(
    `SELECT set_number, condition, richtung, schwelle, currency_code,
            ausgeloest, zuletzt_am, zuletzt_preis
       FROM price_alerts WHERE user_id=$1 AND set_number=$2 ORDER BY condition`,
    [userId, setNumber])
    .catch(e => { require('./httpError').meldeUndWeiter('preisalarm:lesen', e); return []; });
  type Zeile = Omit<Preisalarm, 'schwelle' | 'zuletzt_preis'> &
               { schwelle: string | number; zuletzt_preis: string | number | null };
  return (rows as Zeile[] || []).map(r => ({
    ...r,
    // numeric kommt als Zeichenkette aus dem Treiber — dieselbe Stelle, an der
    // in diesem Baum schon einmal ein Vergleich still falsch wurde.
    schwelle: parseFloat(String(r.schwelle)),
    zuletzt_preis: r.zuletzt_preis == null ? null : parseFloat(String(r.zuletzt_preis)),
  }));
}

/**
 * ALLE Alarme eines Kontos — fuer die Uebersicht in beiden Oberflaechen.
 *
 * ── Marcos Frage vom 25.09. ─────────────────────────────────────────────────
 *
 *   „Wie finde ich alle Preisalarme?"
 *
 * Gar nicht, war die Antwort. Es gab nur alarmeFuer() zu EINEM Set — man sah
 * einen Alarm also nur, wenn man das Set schon gefunden hatte. Wer fuenfzig
 * setzt, hat keinen Ort, an dem sie zusammen stehen, und keinen, an dem er
 * sieht, welche noch scharf sind. Ein Alarm, den man nicht wiederfindet,
 * laesst sich weder pruefen noch abstellen.
 *
 * ── Warum der Name mitkommt ─────────────────────────────────────────────────
 *
 * Eine Liste aus Setnummern ist keine Liste, die man lesen kann. `40820-1`
 * sagt niemandem etwas; „Up-Scaled Santa Minifigure" schon. Der LEFT JOIN und
 * nicht INNER: Ein Alarm auf ein Set, das der Katalog (noch) nicht kennt, darf
 * nicht aus der Uebersicht verschwinden — sonst fehlt genau die Zeile, die man
 * sucht, weil sie sich merkwuerdig verhaelt.
 *
 * ── Kein Blickfeld, kein Haushalt ───────────────────────────────────────────
 *
 * Wie ueberall in dieser Datei: `user_id = $1`. Ein Alarm gehoert genau EINEM
 * Konto (Begruendung im Kopf der Datei). Die Uebersicht zeigt deshalb die
 * eigenen Alarme, nicht die der Unterkonten.
 */
export interface AlarmMitName extends Preisalarm {
  name: string | null;
  set_img_url: string | null;
  /**
   * Die heruntergeladene Kopie des Bildes, falls das Set in der eigenen
   * Sammlung liegt — dieselbe Reihenfolge wie in den Finanzen
   * (`image_local || image_url`). Ohne sie zeigte die Uebersicht fuer ein
   * Set, das man besitzt, ein anderes Bild als die Galerie daneben.
   */
  image_local: string | null;
  image_url: string | null;
  /**
   * Gibt es zu diesem Set eine Detailansicht?
   *
   * Ein Alarm braucht das Set NICHT: `setzeAlarm()` schreibt ohne jede
   * Pruefung, und wer ein Set spaeter aus der Sammlung entfernt, behaelt
   * seinen Alarm. Die Uebersicht macht die Zeile deshalb nur dann anklickbar,
   * wenn es einen Detaildialog dazu gibt — sonst fuehrte der Klick auf
   * `GET /v1/sets/:nummer` und endete in einer Fehlermeldung.
   *
   * ── Warum das BLICKFELD und nicht `user_id` (Nachtrag 139) ────────────────
   *
   * Marcos Befund: „Das Bild in der Android-App ist sichtbar aber die
   * Eintraege in den Preisalarme sind nicht klickbar."
   *
   * Die erste Fassung verband auf `s.user_id = a.user_id` — also streng das
   * eigene Konto. `GET /v1/sets/:nummer` fragt aber ueber `scopeIds()`, das
   * heisst ueber das ganze Blickfeld: eigenes Konto UND Haushalt. Ein Set,
   * das einem Unterkonto gehoert, hat also sehr wohl eine Detailansicht —
   * die Zeile war trotzdem tot.
   *
   * Die Regel lautet deshalb nicht mehr „gehoert mir", sondern „laesst sich
   * oeffnen", und sie benutzt dieselbe Quelle wie die Route, die geoeffnet
   * wird. Zwei Antworten auf dieselbe Frage waeren genau das, was hier
   * auseinandergelaufen ist.
   */
  besitzt: boolean;
}

export async function alleAlarme(userId: number): Promise<AlarmMitName[]> {
  // Dasselbe Blickfeld, das auch `GET /v1/sets/:nummer` benutzt. Der Alarm
  // selbst bleibt beim EIGENEN Konto (siehe Kopf der Datei) — gefragt ist
  // hier nur, ob das Set sichtbar ist.
  const blickfeld = await scopeIds(userId);
  const rows = await db.all(
    // Der zweite LEFT JOIN geht auf das Set im Blickfeld. Er liefert das Bild,
    // das die Galerie zeigt; der Katalog springt ein, wenn es das Set dort gar
    // nicht gibt — und das ist bei einem Preisalarm der haeufige Fall.
    //
    // DISTINCT ON, weil die Verbindung jetzt mehrere Zeilen treffen KANN:
    // `sets` ist ueber (user_id, set_number) eindeutig, aber im Haushalt
    // koennen zwei Konten dasselbe Set haben. Ohne das erschiene der Alarm
    // zweimal — ein Fehler, den die erste Fassung nicht haben konnte und der
    // mit der Erweiterung auf das Blickfeld neu entsteht. Sortiert wird nach
    // `s.image_local` NULLS LAST, damit die Zeile MIT heruntergeladenem Bild
    // gewinnt statt einer beliebigen.
    `SELECT DISTINCT ON (a.set_number, a.condition)
            a.set_number, a.condition, a.richtung, a.schwelle, a.currency_code,
            a.ausgeloest, a.zuletzt_am, a.zuletzt_preis,
            rb.name, rb.set_img_url, s.image_local, s.image_url,
            (s.id IS NOT NULL) AS besitzt
       FROM price_alerts a
       LEFT JOIN rb_sets rb ON rb.set_num = a.set_number
       LEFT JOIN sets s ON s.user_id = ANY($2) AND s.set_number = a.set_number
      WHERE a.user_id = $1
      ORDER BY a.set_number, a.condition, s.image_local NULLS LAST, s.id`,
    [userId, blickfeld])
    .catch(e => { require('./httpError').meldeUndWeiter('preisalarm:alle', e); return []; });
  type Zeile = Omit<AlarmMitName, 'schwelle' | 'zuletzt_preis'> &
               { schwelle: string | number; zuletzt_preis: string | number | null };
  return (rows as Zeile[] || []).map(r => ({
    ...r,
    // numeric kommt als Zeichenkette aus dem Treiber — dieselbe Umwandlung wie
    // in alarmeFuer(), und aus demselben Grund.
    schwelle: parseFloat(String(r.schwelle)),
    zuletzt_preis: r.zuletzt_preis == null ? null : parseFloat(String(r.zuletzt_preis)),
  }));
}

/**
 * Was seit einem Zeitpunkt ausgelöst hat — für die Abholung durch die Clients.
 *
 * ── Warum die App fragt und der Server nicht schiebt ────────────────────────
 *
 * Die Alternative wäre echtes Push (Firebase). Das hiesse: ein Google-Projekt,
 * eine Konfigurationsdatei im Baum, und jede Meldung — welches Set, welcher
 * Preis — liefe über fremde Server. Für eine selbstgehostete Sammlung ist das
 * eine schwere Abhängigkeit für eine leichte Nachricht.
 *
 * Und sie kauft hier fast nichts: Der Preislauf läuft stündlich
 * (price_job_interval_minutes, Vorgabe 60). Eine Meldung kann gar nicht
 * schneller entstehen, als ein stündliches Nachfragen sie abholt.
 *
 * ── Warum `now` mit zurückkommt ─────────────────────────────────────────────
 *
 * Der Aufrufer merkt sich, bis wann er schon gefragt hat, und schickt das
 * beim nächsten Mal als `seit`. Nähme er dafür seine EIGENE Uhr, entschiede
 * die Gangabweichung zwischen Telefon und Server darüber, ob eine Meldung
 * doppelt kommt (Telefonuhr geht nach) oder verloren geht (sie geht vor).
 * Beides fiele niemandem als Uhrenproblem auf.
 *
 * Deshalb liefert der Server den Zeitpunkt, den der Klient beim nächsten Mal
 * einsetzen soll — aus derselben Uhr, aus der auch `zuletzt_am` stammt.
 *
 * ── Ohne `seit` kommt NICHTS ────────────────────────────────────────────────
 *
 * Eine frisch installierte App soll nicht mit Meldungen über Kursschwellen
 * von vor drei Wochen aufschlagen. Der erste Aufruf setzt nur die Marke.
 */
export async function ausgeloesteSeit(userId: number, seit: unknown) {
  // ── Mikrosekunden gegen Millisekunden: der Grund fuer zwei rote Laeufe ───
  //
  // Postgres speichert MIKROsekunden, JavaScript kennt nur MILLIsekunden.
  // Gemessen:
  //
  //     Postgres  : 2026-09-19 20:33:04.996699+00
  //     JavaScript: 2026-09-19T20:33:04.996Z
  //
  // Der Zeitpunkt, den diese Funktion zurueckgibt, geht als ISO-Text zum
  // Klienten — drei Nachkommastellen — und kommt so zurueck. Er ist damit
  // KLEINER als der Wert in der Datenbank, und eine Meldung aus derselben
  // Millisekunde erfuellt `zuletzt_am > marke` weiterhin. Sie kommt ein
  // zweites Mal.
  //
  // Das war kein Randfall: CI-Laeufe 208 und 211/212 sind daran gescheitert
  // und liessen sich lokal nicht nachstellen — auf dem Laeufer liegen
  // Schreiben und Lesen dichter beieinander. Der Fehler traf nicht nur den
  // Test, sondern jeden Klienten.
  //
  // ── Behoben wird es an EINER Stelle, dem Vergleich ───────────────────────
  //
  // Der erste Entwurf rechnete an drei Stellen auf Millisekunden: hier beim
  // Lesen, unten beim Vergleich und beim Schreiben des Merkers. Die
  // Gegenprobe hat gezeigt, dass nur der VERGLEICH etwas bewirkt — die
  // beiden anderen liessen sich zurueckdrehen, ohne dass ein Test rot wurde.
  //
  // Sie sind deshalb draussen. Eine Zeile, deren Wirkung sich nicht zeigen
  // laesst, sieht beim naechsten Lesen aus wie eine Vorsichtsmassnahme und
  // ist in Wahrheit Ballast.
  //
  // Der Vergleich kuerzt die SPALTE und nicht nur den neuen Wert, weil
  // Zeilen, die vor dieser Aenderung geschrieben wurden, noch Mikrosekunden
  // tragen — Marcos laufende Datenbank ist voll davon. Das kostet die
  // Indexnutzung auf zuletzt_am; bei hoechstens zwei Zeilen je Konto und Set
  // ist das kein Preis.
  const jetztRow = await db.get('SELECT NOW() AS jetzt');
  const jetzt = jetztRow?.jetzt ?? new Date();

  // `seit instanceof Date` ZUERST, und das ist kein Schoenheitsfehler: Ein
  // Date laeuft durch String() als "Fri Sep 19 2026 17:53:56 GMT+0000" — OHNE
  // Millisekunden. Zurueckgelesen ergibt das einen bis zu 999 ms frueheren
  // Zeitpunkt, und eine Meldung aus derselben Sekunde kommt ein zweites Mal.
  // Ueber HTTP faellt das nicht auf (res.json() schreibt ISO-8601 mit
  // Millisekunden), ein Aufrufer im selben Prozess reicht aber das Date durch.
  const marke = seit instanceof Date ? seit
    : seit === undefined || seit === null || String(seit).trim() === ''
      ? null : new Date(String(seit));
  // Ein unlesbares Datum wie eine fehlende Marke behandeln — und NICHT wie
  // „seit Anbeginn". Ein Tippfehler im Parameter darf keine Flut auslösen.
  if (!marke || Number.isNaN(marke.getTime())) return { alerts: [], now: jetzt };

  const rows = await db.all(
    `SELECT set_number, condition, richtung, schwelle, currency_code,
            zuletzt_am, zuletzt_preis
       FROM price_alerts
      WHERE user_id = $1 AND ausgeloest = TRUE
        -- Auch die SPALTE auf Millisekunden: Zeilen, die vor dieser Aenderung
        -- geschrieben wurden, tragen noch Mikrosekunden.
        AND zuletzt_am IS NOT NULL AND date_trunc('milliseconds', zuletzt_am) > $2
      ORDER BY zuletzt_am`,
    [userId, marke])
    .catch(e => { require('./httpError').meldeUndWeiter('preisalarm:abholen', e); return []; });

  type Zeile = { set_number: string; condition: string; richtung: Richtung;
                 schwelle: string | number; currency_code: string;
                 zuletzt_am: string; zuletzt_preis: string | number | null };
  return {
    alerts: (rows as Zeile[] || []).map(r => ({
      ...r,
      schwelle: parseFloat(String(r.schwelle)),
      zuletzt_preis: r.zuletzt_preis == null ? null : parseFloat(String(r.zuletzt_preis)),
    })),
    now: jetzt,
  };
}

/**
 * Ist die Schwelle gerissen?
 *
 * Eigene Funktion, obwohl es eine Zeile ist: Sie ist die einzige Stelle, an
 * der „unter" und „ueber" etwas bedeuten, und damit die einzige, an der ein
 * Vorzeichenfehler entsteht. Als Ausdruck mitten in einer Schleife wäre sie
 * nicht für sich prüfbar.
 */
export function reisst(richtung: Richtung, preis: number, schwelle: number): boolean {
  return richtung === 'unter' ? preis < schwelle : preis > schwelle;
}

/**
 * Alle Alarme zu EINEM Set prüfen und bei Übergang benachrichtigen.
 *
 * ── Die Hysterese ───────────────────────────────────────────────────────────
 *
 * Gemeldet wird der ÜBERGANG, nicht der Zustand. Bleibt der Preis unter der
 * Schwelle, bleibt es bei der einen Meldung; steigt er darüber und fällt
 * später wieder, meldet der Alarm erneut. Eine Sperrfrist („höchstens einmal
 * pro Woche") wäre die naheliegende und die falsche Antwort: Sie verschluckt
 * genau das zweite Unterschreiten, das wieder interessant ist.
 *
 * ── Warum der Versand einen Fehler nicht weiterreicht ───────────────────────
 *
 * Diese Funktion läuft IM PREISLAUF. Ein nicht erreichbarer SMTP-Server darf
 * den Lauf nicht abbrechen — die Preise sind dann trotzdem geholt. Der Fehler
 * wird gemeldet (meldeUndWeiter), und der Merker bleibt ungesetzt: Beim
 * nächsten Lauf wird es erneut versucht.
 *
 * @returns wie viele Benachrichtigungen verschickt wurden
 */
// `html` ist optional, damit ein Aufrufer ohne Gestaltung (ein Test, ein
// Werkzeug) weiterhin nur Betreff und Text liefern muss.
export type Versender = (mail: { to: string; subject: string; text: string; html?: string }) => Promise<unknown>;

/**
 * Der Versand als PARAMETER, nicht als Import im Rumpf.
 *
 * ── Warum (beim Schreiben des Tests gemerkt) ────────────────────────────────
 *
 * Der erste Entwurf holte sendMail über ein spätes `require()`. Im Test liess
 * sich das nicht ersetzen: TypeScript übersetzt `export { sendMail }` zu einem
 * GETTER auf dem Modulobjekt, und eine Zuweisung darauf verpufft lautlos — der
 * Test lief gegen den echten Versand und zählte null Meldungen, ohne dass
 * irgendwo ein Fehler stand.
 *
 * Das ist nicht nur ein Testproblem: Eine Funktion, deren Aussenwirkung sich
 * nicht austauschen lässt, ist eine, die man nur im Betrieb prüfen kann.
 */
async function standardVersand(mail: { to: string; subject: string; text: string }) {
  return require('./mailer').sendMail(mail);
}

export async function pruefeSet(setNumber: string,
                                versende: Versender = standardVersand): Promise<number> {
  const { meldeUndWeiter } = require('./httpError');
  const alarme = await db.all(
    `SELECT a.user_id, a.set_number, a.condition, a.richtung, a.schwelle,
            a.currency_code, a.ausgeloest, u.email, u.username,
            COALESCE(us.value, 'de') AS sprache
       FROM price_alerts a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_settings us ON us.user_id = a.user_id AND us.key = 'language'
      WHERE a.set_number = $1`, [setNumber])
    // Gemeldet, nicht verschluckt: Faellt diese Abfrage aus (fehlende Tabelle
    // auf einer alten Datenbank, Verbindungsabbruch), sieht man sonst nur,
    // dass keine Mails kommen — und sucht den Fehler beim SMTP-Server.
    .catch(e => { meldeUndWeiter('preisalarm:alarme-lesen', e); return []; });
  if (!alarme?.length) return 0;
  let verschickt = 0;
  for (const a of alarme as AlarmZeile[]) {
    const preisZeile = await db.get(
      `SELECT avg_price FROM price_cache
        WHERE set_number=$1 AND condition=$2 AND currency_code=$3`,
      [a.set_number, a.condition, a.currency_code])
      .catch(e => { meldeUndWeiter('preisalarm:preis-lesen', e); return null; });
    const preis = preisZeile?.avg_price == null ? null : parseFloat(String(preisZeile.avg_price));
    // Kein Preis in DIESER Währung: Der Alarm ist nicht falsch, nur (noch)
    // nicht beantwortbar. Er bleibt stehen, und der Merker bleibt, wie er ist.
    if (preis == null || !(preis > 0)) continue;

    const schwelle = parseFloat(String(a.schwelle));
    const jetzt = reisst(a.richtung, preis, schwelle);

    if (!jetzt) {
      // Zurück auf die andere Seite — der nächste Übergang meldet wieder.
      if (a.ausgeloest) {
        await db.run(`UPDATE price_alerts SET ausgeloest = FALSE
                       WHERE user_id=$1 AND set_number=$2 AND condition=$3`,
          [a.user_id, a.set_number, a.condition])
          .catch(e => meldeUndWeiter('preisalarm:merker-loeschen', e));
      }
      continue;
    }
    if (a.ausgeloest) continue;          // schon gemeldet, nichts Neues

    if (a.email) {
      try {
        await verschicke(versende, a, preis, schwelle);
        verschickt++;
      } catch (e) {
        // Merker NICHT setzen — beim nächsten Lauf erneut versuchen.
        meldeUndWeiter('preisalarm:versand', e);
        continue;
      }
    }
    await db.run(
      `UPDATE price_alerts SET ausgeloest = TRUE, zuletzt_am = NOW(), zuletzt_preis = $4
        WHERE user_id=$1 AND set_number=$2 AND condition=$3`,
      [a.user_id, a.set_number, a.condition, preis])
      // Bleibt der Merker ungesetzt, meldet der naechste Lauf dieselbe
      // Schwelle noch einmal. Laestig, aber besser als stumm: Genau deshalb
      // wird der Fehler gemeldet und nicht verschluckt.
      .catch(e => meldeUndWeiter('preisalarm:merker-setzen', e));
  }
  return verschickt;
}

/**
 * Die Mail. Getrennt, damit pruefeSet() über das WANN entscheidet, nicht über
 * das WIE.
 *
 * Die GESTALTUNG steht seit dem 25.09. in utils/mailer.ts (baueAlarmMail) —
 * dort, wo auch die Bestätigungs- und die Reset-Mail entstehen. Marcos
 * Vorgabe: „Kannst du die Mail noch etwas schöner gestalten analog der E-Mail
 * Bestätigen Mail?" Sie war die einzige ohne Hülle.
 *
 * Hier bleibt, was diese Datei weiss und der Mailer nicht: welcher Alarm für
 * welches Konto gerissen ist, in welcher Sprache dieses Konto liest und in
 * welcher Währung die Schwelle gesetzt wurde.
 *
 * Der Name aus dem Katalog kommt über einen eigenen kleinen Zugriff. Er ist
 * optional: Ein Set, das rb_sets nicht kennt, trägt in der Mail seine Nummer —
 * dieselbe Regel wie in der Merkliste.
 */
async function verschicke(versende: Versender, a: AlarmZeile, preis: number, schwelle: number) {
  const name = await db.get('SELECT name FROM rb_sets WHERE set_num = $1', [a.set_number])
    .catch(() => null);
  const mail = await require('./mailer').baueAlarmMail({
    username:  a.username,
    lang:      String(a.sprache),
    setNumber: a.set_number,
    setName:   name?.name ?? null,
    condition: a.condition,
    richtung:  a.richtung,
    schwelle,
    preis,
    waehrung:  a.currency_code,
  });
  await versende({ to: a.email!, ...mail });
}
