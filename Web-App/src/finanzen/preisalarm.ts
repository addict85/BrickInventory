/**
 * Preisalarm — sag Bescheid, wenn ein Set eine Schwelle reisst.
 * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#abschnitt
 */
import { meldeUndLiefere, meldeUndWeiter } from '../infra/httpError';
import { scopeIds } from '../haushalt/haushalt';
import { fehlerWerfen } from '../infra/fehlerTexte';
import * as httpError from '../infra/httpError';
import * as mailer from '../infra/mailer';
import { toCsv, csvZeilenAusAnfrage, uebersprungenHinweis } from '../infra/csvExport';
import { normalizeSetNumber } from '../sets/setAdd';
import * as repo from './repository/preisalarme';

/**
 * Eine Alarmzeile samt Empfänger — das, was pruefeSet() aus der Datenbank
 * bekommt.
 * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#alarmzeile
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
  /** Liegt das Set im Blickfeld des Kontos? Daran hängt die Detailansicht. */
  besitzt: boolean;
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
 * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#setzealarm
 */
export async function setzeAlarm(
  userId: number, setNumber: string, waehrung: string,
  eingabe: { richtung?: unknown; schwelle?: unknown; condition?: unknown },
): Promise<Preisalarm> {
  const { richtung, schwelle, condition } =
    pruefeEingabe(eingabe.richtung, eingabe.schwelle, eingabe.condition);
  await repo.schreibeAlarm(userId, setNumber, condition, richtung, schwelle, waehrung);
  const alarme = await alarmeFuer(userId, setNumber);
  return alarme.find(a => a.condition === condition)!;
}

/** Alarm entfernen. Kein Fehler, wenn es keinen gab — der Wunsch ist erfüllt. */
export async function loescheAlarm(userId: number, setNumber: string, condition: string) {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await repo.entferneAlarm(userId, setNumber, c);
  return r.changes ?? 0;
}

/**
 * Liegt das Set im Blickfeld ($3)? Die App macht daran die Zeile anklickbar —
 * dieselbe Frage wie in alleAlarme(), nur ohne den Join auf das Bild.
 */
const BESITZT_SQL = `EXISTS (SELECT 1 FROM sets s WHERE s.user_id = ANY($3) AND s.set_number = a.set_number) AS besitzt`;

/** Die Alarme EINES Kontos zu einem Set (höchstens zwei: N und U). */
export async function alarmeFuer(userId: number, setNumber: string): Promise<Preisalarm[]> {
  const rows = await repo.alarmeDesSets(userId, setNumber, await scopeIds(userId), BESITZT_SQL)
    .catch(e => { httpError.meldeUndWeiter('preisalarm:lesen', e); return []; });
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
 * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#alarmmitname
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
   * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#alarmmitname-2
   */
  besitzt: boolean;
}

export async function alleAlarme(userId: number): Promise<AlarmMitName[]> {
  // Dasselbe Blickfeld, das auch `GET /v1/sets/:nummer` benutzt. Der Alarm
  // selbst bleibt beim EIGENEN Konto (siehe Kopf der Datei) — gefragt ist
  // hier nur, ob das Set sichtbar ist.
  const blickfeld = await scopeIds(userId);
  const rows = await repo.alarmeImBlickfeld(userId, blickfeld)
    .catch(e => { httpError.meldeUndWeiter('preisalarm:alle', e); return []; });
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
 * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#ausgeloesteseit
 */
export async function ausgeloesteSeit(userId: number, seit: unknown) {
  // Mikrosekunden gegen Millisekunden: der Grund fuer zwei rote Laeufe
  // Postgres speichert MIKROsekunden, JavaScript kennt nur MILLIsekunden.
  // Gemessen:
  // Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#ausgeloesteseit-jetztrow
  const jetztRow = await repo.datenbankJetzt();
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

  const rows = await repo.alarmeDesKontos(userId, marke, await scopeIds(userId), BESITZT_SQL)
    .catch(e => { httpError.meldeUndWeiter('preisalarm:abholen', e); return []; });

  type Zeile = { set_number: string; condition: string; richtung: Richtung;
                 schwelle: string | number; currency_code: string; ausgeloest: boolean; besitzt: boolean;
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
 * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#versender
 * @returns wie viele Benachrichtigungen verschickt wurden
 */
// `html` ist optional, damit ein Aufrufer ohne Gestaltung (ein Test, ein
// Werkzeug) weiterhin nur Betreff und Text liefern muss.
export type Versender = (mail: { to: string; subject: string; text: string; html?: string }) => Promise<unknown>;

/**
 * Der Versand als PARAMETER, nicht als Import im Rumpf.
 * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#standardversand
 */
async function standardVersand(mail: { to: string; subject: string; text: string }) {
  return mailer.sendMail(mail);
}

export async function pruefeSet(setNumber: string,
                                versende: Versender = standardVersand): Promise<number> {
  const alarme = await repo.alleAktivenAlarme(setNumber)
    // Gemeldet, nicht verschluckt: Faellt diese Abfrage aus (fehlende Tabelle
    // auf einer alten Datenbank, Verbindungsabbruch), sieht man sonst nur,
    // dass keine Mails kommen — und sucht den Fehler beim SMTP-Server.
    .catch(e => { meldeUndWeiter('preisalarm:alarme-lesen', e); return []; });
  if (!alarme?.length) return 0;
  let verschickt = 0;
  for (const a of alarme as AlarmZeile[]) {
    const preisZeile = await repo.cachePreisFuerAlarm(a.set_number, a.condition, a.currency_code)
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
        await repo.setzeAlarmZurueck(a.user_id, a.set_number, a.condition)
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
    await repo.loeseAlarmAus(a.user_id, a.set_number, a.condition, preis)
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
 * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#verschicke
 */
async function verschicke(versende: Versender, a: AlarmZeile, preis: number, schwelle: number) {
  const name = await repo.setNameAusStamm(a.set_number)
    .catch(meldeUndLiefere('preisalarm:name', null));
  const mail = await mailer.baueAlarmMail({
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
 * Ausführlich: docs/begruendungen/src/finanzen/preisalarm.ts.md#buildpreisalarmecsv
 */
export async function buildPreisalarmeCsv(uid: number): Promise<string> {
  const rows = await repo.alarmeFuerExport(uid);

  return toCsv(['set_number', 'condition', 'richtung', 'schwelle', 'currency_code'],
    // schwelle kommt als NUMERIC, also als Zeichenkette aus dem Treiber. Ohne
    // das Umwandeln stand im Export „200.0000" statt „200" — richtig, aber
    // niemand schreibt eine Schwelle so hin, und beim Wiedereinlesen durch ein
    // Tabellenprogramm wird daraus je nach Gebietseinstellung etwas anderes.
    rows.map((r: any) => ({ ...r, schwelle: Number(r.schwelle) })));
}

/**
 * Preisalarme aus einer CSV (Gegenstück zu buildPreisalarmeCsv). Die
 * Schwellen gelten in der Kontowährung; stand eine andere in der Datei, sagt
 * die Antwort es, statt still umzurechnen — Kurse gibt es keine.
 */
export async function alarmeAusCsv(uid: number, waehrung: string, text: string) {
  const { records, bereinigt, uebersprungen } = csvZeilenAusAnfrage(text);
  let added = 0, updated = 0, errors = 0, fremdeWaehrung = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const row of bereinigt) {
    const roh = String(row.set_number || row['Setnummer'] || row['set_num'] || Object.values(row)[0] || '').trim();
    if (!roh) continue;
    const sn = normalizeSetNumber(roh);
    // Vor dem Schreiben fragen: setzeAlarm() legt an oder ändert, ohne es zu sagen.
    const schon = await alarmeFuer(uid, sn);
    const dateiWaehrung = String(row.currency_code || row['waehrung'] || '').trim().toUpperCase();
    const abweichend = dateiWaehrung !== '' && dateiWaehrung !== waehrung.toUpperCase();
    try {
      const alarm = await setzeAlarm(uid, sn, waehrung, {
        richtung: String(row.richtung || row['Richtung'] || '').trim().toLowerCase(),
        // Komma als Dezimalzeichen wie in csvGemeinsameFelder.
        schwelle: String(row.schwelle || row['Schwelle'] || '').trim().replace(',', '.'),
        condition: String(row.condition || row['zustand'] || row['Zustand'] || 'N').trim().toUpperCase(),
      });
      const war = schon.some(a => a.condition === alarm.condition);
      if (war) updated++; else added++;
      if (abweichend) fremdeWaehrung++;
      results.push({ set_number: sn, condition: alarm.condition, action: war ? 'updated' : 'added',
        ...(abweichend ? { waehrung_angepasst: true, waehrung_datei: dateiWaehrung, waehrung_konto: waehrung } : {}) });
    } catch (e) {
      errors++;
      results.push({ set_number: sn, action: 'error', error: httpError.fehlertext(e) });
    }
  }
  return {
    success: true, added, updated, errors, total: records.length, results,
    skipped: uebersprungen.length || undefined,
    skipped_hint: uebersprungenHinweis(uebersprungen) || undefined,
    ...(fremdeWaehrung ? { waehrung_hinweis:
      `${fremdeWaehrung} Alarm(e) standen in einer anderen Währung als ${waehrung}. ` +
      `Die Schwellen wurden unverändert übernommen und gelten jetzt in ${waehrung} — ` +
      'die Zahlen bitte nachsehen.' } : {}),
  };
}
