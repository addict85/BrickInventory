/** Marktpreis, Preisverlauf und Preisalarm eines Sets. */
import type { Sicht } from '../household';
import { normalisiereSetNummer } from '../infra/setNummer';
import type { Zustand } from '../infra/validate';
import type { CsvImportReport } from '../infra/csvExport';
import * as repo from './repository/setDetail';
import { versuche } from '../infra/ergebnis';
import type { SetsContext } from './kontext';

/** Im Zustand des Bestands. null: kein Set im Blickfeld. */
export async function setPrice(sk: SetsContext, uid: number, scopeChoice: Sicht | number[], sn: string) {
  const blickfeld = await sk.household.scopeFrom(scopeChoice);
  const set = await repo.setInField(sk.db, sn, blickfeld);
  if (!set) return null;
  // Die Währung aus der Einstellung: Die App schickte ihren lokalen Startwert mit, bevor sie die Einstellung
  // kannte.
  const currency = await currencyOf(sk, uid);
  const guideType = String(await sk.einstellungen.userValue(uid, 'price_guide_type', 'sold'));
  const ttlHours = String(await sk.einstellungen.userValue(uid, 'price_cache_ttl', '24'));
  const preis = await versuche('sets:preis', async () =>
    sk.finanzen.fetchPrice(sn, await sk.finanzen.setState(blickfeld, sn), guideType, currency, ttlHours, null),
  );
  if (!preis.ok)
    return {
      set_number: sn,
      currency,
      min_price: null,
      avg_price: null,
      max_price: null,
      qty_avg_price: null,
      no_price: true,
      error: preis.fehler.grund,
    };
  const pd = preis.wert;
  return {
    set_number: sn,
    currency,
    min_price: pd.min_price,
    avg_price: pd.avg_price,
    max_price: pd.max_price,
    qty_avg_price: pd.qty_avg_price,
    from_cache: pd.from_cache,
    no_price: !!(pd as { no_price?: boolean }).no_price,
  };
}

/** Die Währung aus den Einstellungen, nicht aus der Anfrage: Zwei Quellen
 * liefen beim nächsten Wechsel auseinander. */
export async function currencyOf(sk: SetsContext, uid: number): Promise<string> {
  return String(await sk.einstellungen.userValue(uid, 'currency', 'EUR'));
}

export function readSetAlerts(sk: SetsContext, uid: number, sn: string) {
  return sk.finanzen.preisalarm.alertsFor(uid, normalisiereSetNummer(sn));
}

export async function setAlarmOfSets(
  sk: SetsContext,
  uid: number,
  sn: string,
  eingabe: Parameters<SetsContext['finanzen']['preisalarm']['setzeAlarm']>[3],
) {
  return sk.finanzen.preisalarm.setzeAlarm(uid, normalisiereSetNummer(sn), await currencyOf(sk, uid), eingabe);
}

export function deleteAlarmOfSets(sk: SetsContext, uid: number, sn: string, condition: Zustand | undefined) {
  return sk.finanzen.preisalarm.loescheAlarm(uid, normalisiereSetNummer(sn), condition ?? 'N');
}

export async function startAlarmCsvImport(sk: SetsContext, uid: number, text: string) {
  return sk.auftraege.waitOnJob<CsvImportReport, 'csv_import'>(
    'csv_import',
    { user_id: uid, quelle: 'alarme_csv', eingabe: { waehrung: await currencyOf(sk, uid), text } },
    { userId: uid },
  );
}

export async function setPriceHistory(sk: SetsContext, uid: number, sicht: Sicht | number[], sn: string) {
  return sk.finanzen.priceHistorySet(sicht, sn, await currencyOf(sk, uid));
}
