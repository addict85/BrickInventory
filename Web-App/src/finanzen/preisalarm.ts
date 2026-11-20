/** Der Preislauf holt die Marktpreise ohnehin; hier fehlte nur der Schritt,
 * eine Schwelle damit zu vergleichen. Ein Alarm gehört EINEM Konto. */
import { reportError, fehlertext } from '../infra/fehler';
import { fachfehler } from '../infra/fehlerTexte';
import type { MailServices } from '../mail';
import { toCsv, csvRowsFromRequest, skippedHint } from '../infra/csvExport';
import { normalisiereSetNummer } from '../infra/setNummer';
import * as repo from './repository/preisalarme';
import { versuche } from '../infra/ergebnis';
import type { FinancesContext } from './kontext';

export type Richtung = 'unter' | 'ueber';

export interface Preisalarm {
  set_number: string;
  condition: string;
  direction: Richtung;
  threshold: number;
  currency_code: string;
  triggered: boolean;
  last_triggered_at: string | null;
  last_price: number | null;
  /** Daran hängt die Detailansicht. */
  besitzt: boolean;
}

const STATES = new Set(['N', 'U']);

/** Die Zeile wie gelesen (db/zeilen.ts); `direction` hält ein CHECK auf zwei Werte, der Zeitpunkt
 * geht als ISO-Text hinaus wie in JSON. */
function alsAlarm<Z extends repo.AlarmRow>(z: Z): Omit<Z, 'direction' | 'last_triggered_at'> & Preisalarm {
  return { ...z, direction: z.direction as Richtung, last_triggered_at: z.last_triggered_at?.toISOString() ?? null };
}

export interface AlarmInput {
  direction: string;
  threshold: number | string | null | undefined;
  condition?: string | undefined;
}

function checkInput(direction: string, threshold: AlarmInput['threshold'], condition: string | undefined) {
  const r = String(direction ?? '');
  if (r !== 'unter' && r !== 'ueber') fachfehler('ungueltig', 'alarm_richtung_ungueltig');
  const s = Number(threshold);
  // Number.isFinite fängt auch NaN aus einer leeren Eingabe; `> 0` allein
  // meldete zwei verschiedene Fehler gleich.
  if (!Number.isFinite(s) || s <= 0) fachfehler('ungueltig', 'alarm_schwelle_ungueltig');
  const c = (condition ?? 'N').toUpperCase();
  if (!STATES.has(c)) fachfehler('ungueltig', 'alarm_zustand_ungueltig');
  return { direction: r as Richtung, threshold: s, condition: c };
}

/** Höchstens EIN Alarm je Set und Zustand (Primärschlüssel). */
export async function setzeAlarm(
  k: FinancesContext,
  userId: number,
  setNumber: string,
  currency: string,
  eingabe: AlarmInput,
): Promise<Preisalarm> {
  const { direction, threshold, condition } = checkInput(eingabe.direction, eingabe.threshold, eingabe.condition);
  await repo.writeAlarm(k.db, userId, setNumber, condition, direction, threshold, currency);
  const alarme = await alertsFor(k, userId, setNumber);
  return alarme.find(a => a.condition === condition)!;
}

/** Der Alarm wandert mit einer Vormerkung ins andere Konto (src/wanted). */
export async function alarmTransfer(
  k: FinancesContext,
  zuId: number,
  ofId: number,
  setNumber: string,
  condition: string,
): Promise<void> {
  await repo.transferAlarm(k.db, zuId, ofId, setNumber, condition);
}

/** Kein Fehler, wenn es keinen gab — der Wunsch ist erfüllt. */
export async function loescheAlarm(k: FinancesContext, userId: number, setNumber: string, condition: string) {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await repo.removeAlarm(k.db, userId, setNumber, c);
  return r.changes ?? 0;
}

export async function alertsFor(k: FinancesContext, userId: number, setNumber: string): Promise<Preisalarm[]> {
  // Ohne Fang: Eine leere Liste hiesse „kein Alarm“, und setzeAlarm() lieferte nichts.
  const rows = await repo.alertsOfSets(k.db, k.lesevertrag, userId, setNumber, await k.haushalt.scopeIds(userId));
  return rows.map(alsAlarm);
}

/** Damit man Alarme findet, ohne das Set zu kennen. */
export interface AlarmWithName extends Preisalarm {
  name: string | null;
  set_img_url: string | null;
  /** Dieselbe Reihenfolge wie in den Finanzen, sonst zeigte die Übersicht ein
   * anderes Bild als die Galerie daneben. */
  image_local: string | null;
  image_url: string | null;
  // Nur mit Set im Blickfeld anklickbar, sonst endete der Klick in einem Fehler.
  besitzt: boolean;
}

export async function alleAlarme(k: FinancesContext, userId: number): Promise<AlarmWithName[]> {
  // Das Blickfeld fragt nur, ob das Set sichtbar ist; der Alarm bleibt beim
  // eigenen Konto.
  const blickfeld = await k.haushalt.scopeIds(userId);
  return (await repo.alertsInScope(k.db, k.lesevertrag, userId, blickfeld)).map(alsAlarm);
}

/** Die App fragt, statt dass der Server schiebt: Push liefe über fremde Server. */
export async function triggeredSince(k: FinancesContext, userId: number, seit: Date | string | null | undefined) {
  // Die Zeit der Datenbank: Postgres speichert Mikro-, JavaScript nur
  // Millisekunden; mit der JS-Uhr käme eine Meldung zweimal.
  const nowRow = await repo.databaseNow(k.db);
  const jetzt = nowRow?.jetzt ?? k.uhr.datum();

  // `instanceof Date` ZUERST: String(date) verliert die Millisekunden, und eine
  // Meldung aus derselben Sekunde käme ein zweites Mal.
  const marke =
    seit instanceof Date
      ? seit
      : seit === undefined || seit === null || String(seit).trim() === ''
        ? null
        : new Date(String(seit));
  // Unlesbar wie fehlend, NICHT „seit Anbeginn": Ein Tippfehler darf keine Flut auslösen.
  if (!marke || Number.isNaN(marke.getTime())) return { alerts: [], now: jetzt };

  // Ohne Fang: Die App rückte sonst ihre Marke vor und verlöre die Meldungen dazwischen.
  const rows = await repo.alertsOfAccount(k.db, k.lesevertrag, userId, marke, await k.haushalt.scopeIds(userId));
  return { alerts: rows.map(alsAlarm), now: jetzt };
}

/** Eigene Funktion: die einzige Stelle, an der „unter" und „über" etwas
 * bedeuten — und an der ein Vorzeichenfehler entsteht. So ist sie prüfbar. */
export function reisst(direction: Richtung, price: number, threshold: number): boolean {
  return direction === 'unter' ? price < threshold : price > threshold;
}

/** Gemeldet wird der ÜBERGANG, nicht der Zustand. Der Versand kommt als Parameter,
 * damit ein Test ihn ersetzen kann, ohne das Modul umzubiegen. */
export type AlarmPost = Pick<MailServices, 'buildAlertMail' | 'sendMail'>;

export async function checkSet(k: FinancesContext, setNumber: string, post: AlarmPost): Promise<number> {
  const alarme = await repo.allActiveAlerts(k.db, setNumber);
  if (!alarme?.length) return 0;
  let verschickt = 0;
  for (const a of alarme) {
    const priceRow = await repo.cachePriceForAlarm(k.db, a.set_number, a.condition, a.currency_code).catch(e => {
      reportError('preisalarm:preis-lesen', e);
      return null;
    });
    const price = priceRow?.marktpreis ?? null;
    // Kein Preis in DIESER Währung: Der Alarm bleibt, der Merker auch.
    if (price == null || !(price > 0)) continue;

    const jetzt = reisst(a.direction as Richtung, price, a.threshold);

    if (!jetzt) {
      // Zurück auf die andere Seite — der nächste Übergang meldet wieder.
      if (a.triggered) {
        await repo
          .setAlarmBack(k.db, a.user_id, a.set_number, a.condition)
          .catch(e => reportError('preisalarm:merker-loeschen', e));
      }
      continue;
    }
    if (a.triggered) continue; // schon gemeldet, nichts Neues

    if (a.email) {
      try {
        await send(k, post, a, price, a.threshold);
        verschickt++;
      } catch (e) {
        // Merker NICHT setzen — beim nächsten Lauf erneut versuchen.
        reportError('preisalarm:versand', e);
        continue;
      }
    }
    await repo
      .resolveAlarmFrom(k.db, a.user_id, a.set_number, a.condition, price)
      // Ungesetzt meldet der nächste Lauf dieselbe Schwelle noch einmal — lästig,
      // aber besser als stumm.
      .catch(e => reportError('preisalarm:merker-setzen', e));
  }
  return verschickt;
}

/** Getrennt, damit checkSet() über das WANN entscheidet, nicht über das WIE. */
type ActiveAlarm = Awaited<ReturnType<typeof repo.allActiveAlerts>>[number];
async function send(k: FinancesContext, post: AlarmPost, a: ActiveAlarm, price: number, threshold: number) {
  // Der Alarm geht auch ohne Namen hinaus; die Mail nennt dann nur die Setnummer.
  const gelesen = await versuche('preisalarm:name', repo.setNameFromMaster(k.db, a.set_number));
  const name = gelesen.ok ? gelesen.wert : null;
  const mail = await post.buildAlertMail({
    username: a.username,
    lang: a.sprache,
    setNumber: a.set_number,
    setName: name?.name ?? null,
    condition: a.condition,
    direction: a.direction as Richtung,
    threshold,
    price,
    currency: a.currency_code,
  });
  await post.sendMail({ to: a.email!, ...mail });
}

/** Eigene Datei statt Spalten an sets.csv: Ein Alarm braucht das Set nicht zu besitzen. */
export async function preisalarmeAlsCsv(k: FinancesContext, uid: number): Promise<string> {
  const rows = await repo.alertsForExport(k.db, uid);

  return toCsv(
    ['set_number', 'condition', 'direction', 'threshold', 'currency_code'],
    // Number(): sonst stünde „200.0000" im Export.
    rows.map(r => ({ ...r, threshold: Number(r.threshold) })),
  );
}

/** Schwellen gelten in der Kontowährung; eine andere in der Datei wird
 * genannt statt still umgerechnet — Kurse gibt es keine. */
export async function alertsFromCsv(k: FinancesContext, uid: number, currency: string, text: string) {
  const { records, cleaned, uebersprungen } = csvRowsFromRequest(text);
  let added = 0,
    updated = 0,
    errors = 0,
    foreignCurrency = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const row of cleaned) {
    const roh = String(row.set_number || row.Setnummer || row.set_num || Object.values(row)[0] || '').trim();
    if (!roh) continue;
    const sn = normalisiereSetNummer(roh);
    // Vor dem Schreiben fragen: setzeAlarm() legt an oder ändert, ohne es zu sagen.
    const schon = await alertsFor(k, uid, sn);
    const fileCurrency = String(row.currency_code || row.currency || '')
      .trim()
      .toUpperCase();
    const abweichend = fileCurrency !== '' && fileCurrency !== currency.toUpperCase();
    try {
      const alarm = await setzeAlarm(k, uid, sn, currency, {
        // Both the new English header and an older export's German one are accepted on import.
        direction: String(row.direction || row.richtung || row.Richtung || '')
          .trim()
          .toLowerCase(),
        threshold: String(row.threshold || row.schwelle || row.Schwelle || '')
          .trim()
          .replace(',', '.'),
        condition: String(row.condition || row.zustand || row.Zustand || 'N')
          .trim()
          .toUpperCase(),
      });
      const war = schon.some(a => a.condition === alarm.condition);
      if (war) updated++;
      else added++;
      if (abweichend) foreignCurrency++;
      results.push({
        set_number: sn,
        condition: alarm.condition,
        action: war ? 'updated' : 'added',
        ...(abweichend ? { waehrung_angepasst: true, waehrung_datei: fileCurrency, waehrung_konto: currency } : {}),
      });
    } catch (e) {
      errors++;
      results.push({ set_number: sn, action: 'error', error: fehlertext(e) });
    }
  }
  return {
    added,
    updated,
    errors,
    total: records.length,
    results,
    skipped: uebersprungen.length || undefined,
    skipped_hint: skippedHint(uebersprungen) || undefined,
    ...(foreignCurrency
      ? {
          waehrung_hinweis:
            `${foreignCurrency} Alarm(e) standen in einer anderen Währung als ${currency}. ` +
            `Die Schwellen wurden unverändert übernommen und gelten jetzt in ${currency} — ` +
            'die Zahlen bitte nachsehen.',
        }
      : {}),
  };
}
