/** The price run fetches the market prices anyway; the only missing step here was
 * to compare a threshold against them. An alert belongs to ONE account. */
import { reportError, errorMessage } from '../infra/error';
import { failDomain } from '../infra/errorTexts';
import type { MailServices } from '../mail';
import { toCsv, csvRowsFromRequest, skippedHint } from '../infra/csvExport';
import { normalizeSetNumber } from '../infra/setNumber';
import * as repo from './repository/priceAlerts';
import { attempts } from '../infra/result';
import type { FinancesContext } from './context';

export type Direction = 'below' | 'above';

export interface PriceAlert {
  set_number: string;
  condition: string;
  direction: Direction;
  threshold: number;
  currency_code: string;
  triggered: boolean;
  last_triggered_at: string | null;
  last_price: number | null;
  /** The detail view depends on this. */
  owns: boolean;
}

const STATES = new Set(['N', 'U']);

/** The row as read (db/rows.ts); a CHECK keeps `direction` to two values, the point in time
 * goes out as ISO text as in JSON. */
function alsAlarm<Z extends repo.AlarmRow>(z: Z): Omit<Z, 'direction' | 'last_triggered_at'> & PriceAlert {
  return { ...z, direction: z.direction as Direction, last_triggered_at: z.last_triggered_at?.toISOString() ?? null };
}

export interface AlarmInput {
  direction: string;
  threshold: number | string | null | undefined;
  condition?: string | undefined;
}

/** Exports before API v2 wrote the direction in German. */
const csvDirection = (raw: unknown) => {
  const r = String(raw ?? '')
    .trim()
    .toLowerCase();
  return r === 'unter' ? 'below' : r === 'ueber' ? 'above' : r;
};

function checkInput(direction: string, threshold: AlarmInput['threshold'], condition: string | undefined) {
  const r = String(direction ?? '');
  if (r !== 'below' && r !== 'above') failDomain('ungueltig', 'alert_direction_invalid');
  const s = Number(threshold);
  // Number.isFinite also catches NaN from an empty input; `> 0` alone
  // would report two different errors the same way.
  if (!Number.isFinite(s) || s <= 0) failDomain('ungueltig', 'alert_threshold_invalid');
  const c = (condition ?? 'N').toUpperCase();
  if (!STATES.has(c)) failDomain('ungueltig', 'alert_condition_invalid');
  return { direction: r as Direction, threshold: s, condition: c };
}

/** At most ONE alert per set and condition (primary key). */
export async function setAlert(
  k: FinancesContext,
  userId: number,
  setNumber: string,
  currency: string,
  input: AlarmInput,
): Promise<PriceAlert> {
  const { direction, threshold, condition } = checkInput(input.direction, input.threshold, input.condition);
  await repo.writeAlarm(k.db, userId, setNumber, condition, direction, threshold, currency);
  const alerts = await alertsFor(k, userId, setNumber);
  return alerts.find(a => a.condition === condition)!;
}

/** The alert moves along with a reservation into the other account (src/wanted). */
export async function alarmTransfer(
  k: FinancesContext,
  zuId: number,
  ofId: number,
  setNumber: string,
  condition: string,
): Promise<void> {
  await repo.transferAlarm(k.db, zuId, ofId, setNumber, condition);
}

/** No error if there was none — the wish is fulfilled. */
export async function deleteAlert(k: FinancesContext, userId: number, setNumber: string, condition: string) {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await repo.removeAlarm(k.db, userId, setNumber, c);
  return r.changes ?? 0;
}

export async function alertsFor(k: FinancesContext, userId: number, setNumber: string): Promise<PriceAlert[]> {
  // No catch: an empty list would mean "no alert", and setzeAlarm() would deliver nothing.
  const rows = await repo.alertsOfSets(k.db, k.readContract, userId, setNumber, await k.household.scopeIds(userId));
  return rows.map(alsAlarm);
}

/** So that alerts can be found without knowing the set. */
export interface AlarmWithName extends PriceAlert {
  name: string | null;
  set_img_url: string | null;
  /** The same order as in the finances, otherwise the overview would show a
   * different picture than the gallery next to it. */
  image_local: string | null;
  image_url: string | null;
  // Clickable only with the set in scope, otherwise the click would end in an error.
  owns: boolean;
}

export async function allAlerts(k: FinancesContext, userId: number): Promise<AlarmWithName[]> {
  // The scope only asks whether the set is visible; the alert stays with the
  // own account.
  const scope = await k.household.scopeIds(userId);
  return (await repo.alertsInScope(k.db, k.readContract, userId, scope)).map(alsAlarm);
}

/** The app asks instead of the server pushing: push would go via third-party servers. */
export async function triggeredSince(k: FinancesContext, userId: number, since: Date | string | null | undefined) {
  // The database's time: Postgres stores micro-, JavaScript only
  // milliseconds; with the JS clock a notification would come twice.
  const nowRow = await repo.databaseNow(k.db);
  const now = nowRow?.now ?? k.clock.datum();

  // `instanceof Date` FIRST: String(date) loses the milliseconds, and a
  // notification from the same second would come a second time.
  const mark =
    since instanceof Date
      ? since
      : since === undefined || since === null || String(since).trim() === ''
        ? null
        : new Date(String(since));
  // Unreadable like missing, NOT "since the beginning of time": a typo must not trigger a flood.
  if (!mark || Number.isNaN(mark.getTime())) return { alerts: [], now: now };

  // No catch: the app would otherwise advance its marker and lose the notifications in between.
  const rows = await repo.alertsOfAccount(k.db, k.readContract, userId, mark, await k.household.scopeIds(userId));
  return { alerts: rows.map(alsAlarm), now: now };
}

/** A function of its own: the only place where "below" and "above" mean
 * something — and where a sign error arises. That way it is testable. */
export function crosses(direction: Direction, price: number, threshold: number): boolean {
  return direction === 'below' ? price < threshold : price > threshold;
}

/** The TRANSITION is reported, not the state. Sending comes as a parameter
 * so that a test can replace it without bending the module. */
export type AlarmPost = Pick<MailServices, 'buildAlertMail' | 'sendMail'>;

export async function checkSet(k: FinancesContext, setNumber: string, post: AlarmPost): Promise<number> {
  const alerts = await repo.allActiveAlerts(k.db, setNumber);
  if (!alerts?.length) return 0;
  let sent = 0;
  for (const a of alerts) {
    const priceRow = await repo.cachePriceForAlarm(k.db, a.set_number, a.condition, a.currency_code).catch(e => {
      reportError('preisalarm:preis-lesen', e);
      return null;
    });
    const price = priceRow?.market_price ?? null;
    // No price in THIS currency: the alert stays, and so does the flag.
    if (price == null || !(price > 0)) continue;

    const now = crosses(a.direction as Direction, price, a.threshold);

    if (!now) {
      // Back to the other side — the next transition reports again.
      if (a.triggered) {
        await repo
          .setAlarmBack(k.db, a.user_id, a.set_number, a.condition)
          .catch(e => reportError('preisalarm:merker-loeschen', e));
      }
      continue;
    }
    if (a.triggered) continue; // already reported, nothing new

    if (a.email) {
      try {
        await send(k, post, a, price, a.threshold);
        sent++;
      } catch (e) {
        // Do NOT set the flag — try again on the next run.
        reportError('preisalarm:versand', e);
        continue;
      }
    }
    await repo
      .resolveAlarmFrom(k.db, a.user_id, a.set_number, a.condition, price)
      // Unset, the next run reports the same threshold once more — annoying,
      // but better than silent.
      .catch(e => reportError('preisalarm:merker-setzen', e));
  }
  return sent;
}

/** Separate, so that checkSet() decides on the WHEN, not on the HOW. */
type ActiveAlarm = Awaited<ReturnType<typeof repo.allActiveAlerts>>[number];
async function send(k: FinancesContext, post: AlarmPost, a: ActiveAlarm, price: number, threshold: number) {
  // The alert goes out even without a name; the mail then only names the set number.
  const read = await attempts('preisalarm:name', repo.setNameFromMaster(k.db, a.set_number));
  const name = read.ok ? read.wert : null;
  const mail = await post.buildAlertMail({
    username: a.username,
    lang: a.language,
    setNumber: a.set_number,
    setName: name?.name ?? null,
    condition: a.condition,
    direction: a.direction as Direction,
    threshold,
    price,
    currency: a.currency_code,
  });
  await post.sendMail({ to: a.email!, ...mail });
}

/** A file of its own instead of columns in sets.csv: an alert does not require owning the set. */
export async function priceAlertsAsCsv(k: FinancesContext, uid: number): Promise<string> {
  const rows = await repo.alertsForExport(k.db, uid);

  return toCsv(
    ['set_number', 'condition', 'direction', 'threshold', 'currency_code'],
    // Number(): otherwise "200.0000" would appear in the export.
    rows.map(r => ({ ...r, threshold: Number(r.threshold) })),
  );
}

/** Thresholds apply in the account currency; another one in the file is
 * named instead of silently converted — there are no rates. */
export async function alertsFromCsv(k: FinancesContext, uid: number, currency: string, text: string) {
  const { records, cleaned, uebersprungen } = csvRowsFromRequest(text);
  let added = 0,
    updated = 0,
    errors = 0,
    foreignCurrency = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const row of cleaned) {
    const raw = String(row.set_number || row.Setnummer || row.set_num || Object.values(row)[0] || '').trim();
    if (!raw) continue;
    const sn = normalizeSetNumber(raw);
    // Ask before writing: setzeAlarm() creates or changes without saying so.
    const already = await alertsFor(k, uid, sn);
    const fileCurrency = String(row.currency_code || row.currency || '')
      .trim()
      .toUpperCase();
    const divergent = fileCurrency !== '' && fileCurrency !== currency.toUpperCase();
    try {
      const alarm = await setAlert(k, uid, sn, currency, {
        // Both the new English header and an older export's German one are accepted on import.
        direction: csvDirection(row.direction || row.richtung || row.Richtung),
        threshold: String(row.threshold || row.schwelle || row.Schwelle || '')
          .trim()
          .replace(',', '.'),
        condition: String(row.condition || row.zustand || row.Zustand || 'N')
          .trim()
          .toUpperCase(),
      });
      const war = already.some(a => a.condition === alarm.condition);
      if (war) updated++;
      else added++;
      if (divergent) foreignCurrency++;
      results.push({
        set_number: sn,
        condition: alarm.condition,
        action: war ? 'updated' : 'added',
        ...(divergent ? { currency_adjusted: true, file_currency: fileCurrency, account_currency: currency } : {}),
      });
    } catch (e) {
      errors++;
      results.push({ set_number: sn, action: 'error', error: errorMessage(e) });
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
          currency_note:
            `${foreignCurrency} Alarm(e) standen in einer anderen Währung als ${currency}. ` +
            `Die Schwellen wurden unverändert übernommen und gelten jetzt in ${currency} — ` +
            'die Zahlen bitte nachsehen.',
        }
      : {}),
  };
}
