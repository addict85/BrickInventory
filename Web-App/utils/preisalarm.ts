/**
 * Preisalarm — sag Bescheid, wenn ein Set eine Schwelle reisst.
 * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#abschnitt
 */
import * as db from '../db/database';
import { scopeIds } from './household';
import { fehlerWerfen } from './fehlerTexte';

/**
 * Eine Alarmzeile samt Empfänger — das, was pruefeSet() aus der Datenbank
 * bekommt.
 * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#alarmzeile
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
 * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#setzealarm
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
 * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#alarmmitname
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
   * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#alarmmitname-2
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
    // Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#allealarme
    `SELECT DISTINCT ON (a.set_number, a.condition)
            a.set_number, a.condition, a.richtung, a.schwelle, a.currency_code,
            a.ausgeloest, a.zuletzt_am, a.zuletzt_preis,
            rb.name, rb.set_img_url, c.image_local, c.image_url,
            (s.id IS NOT NULL) AS besitzt
       FROM price_alerts a
       LEFT JOIN rb_sets rb ON rb.set_num = a.set_number
       -- sets sagt, ob der Haushalt das Set BESITZT (daran haengt die Spalte
       -- besitzt und der Detaildialog), set_catalog liefert das Bild.
       LEFT JOIN sets s ON s.user_id = ANY($2) AND s.set_number = a.set_number
       LEFT JOIN set_catalog c ON c.set_number = a.set_number
      WHERE a.user_id = $1
      ORDER BY a.set_number, a.condition, c.image_local NULLS LAST, s.id`,
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
 * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#ausgeloesteseit
 */
export async function ausgeloesteSeit(userId: number, seit: unknown) {
  // Mikrosekunden gegen Millisekunden: der Grund fuer zwei rote Laeufe
  // Postgres speichert MIKROsekunden, JavaScript kennt nur MILLIsekunden.
  // Gemessen:
  // Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#ausgeloesteseit-jetztrow
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
 * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#versender
 * @returns wie viele Benachrichtigungen verschickt wurden
 */
// `html` ist optional, damit ein Aufrufer ohne Gestaltung (ein Test, ein
// Werkzeug) weiterhin nur Betreff und Text liefern muss.
export type Versender = (mail: { to: string; subject: string; text: string; html?: string }) => Promise<unknown>;

/**
 * Der Versand als PARAMETER, nicht als Import im Rumpf.
 * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#standardversand
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
 * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#verschicke
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

/**
 * Die Preisalarme EINES Kontos als CSV — für den ZIP-Export.
 * Ausführlich: docs/begruendungen/utils/preisalarm.ts.md#buildpreisalarmecsv
 */
export async function buildPreisalarmeCsv(uid: number): Promise<string> {
  const { toCsv } = require('./csvExport');
  const { meldeUndWeiter } = require('./httpError');
  const rows = await db.all(
    `SELECT set_number, condition, richtung, schwelle, currency_code
       FROM price_alerts
      WHERE user_id = $1
      ORDER BY set_number, condition`,
    [uid])
    // price_alerts steht nur in db/migrations/0019-preisalarm.sql — ein Aufbau,
    // der bloss initSchema() gelaufen ist, hat die Tabelle nicht (die
    // Begruendung steht in db/schema.sql). Eine leere Datei im Archiv ist dort
    // die richtige Antwort; ein Fehler riss sonst den GANZEN ZIP-Export mit.
    .catch((e: unknown) => { meldeUndWeiter('preisalarm:export', e); return []; });

  return toCsv(['set_number', 'condition', 'richtung', 'schwelle', 'currency_code'],
    // schwelle kommt als NUMERIC, also als Zeichenkette aus dem Treiber. Ohne
    // das Umwandeln stand im Export „200.0000" statt „200" — richtig, aber
    // niemand schreibt eine Schwelle so hin, und beim Wiedereinlesen durch ein
    // Tabellenprogramm wird daraus je nach Gebietseinstellung etwas anderes.
    rows.map((r: any) => ({ ...r, schwelle: Number(r.schwelle) })));
}
