/** Marktpreis, Preisverlauf und Preisalarm eines Sets. */
import { blickfeldAus } from '../haushalt/haushalt';
import type { Sicht } from '../haushalt/haushalt';
import { getSetting } from '../einstellungen/settings';
import { alarmeFuer, loescheAlarm, setzeAlarm } from '../finanzen/preisalarm';
import { importAlsAuftrag } from '../auftraege/importAlsAuftrag';
import { normalizeSetNumber } from './erfassen';
import { Zustand } from '../infra/validate';
import { fetchPrice, resolveSetCondition } from '../finanzen/financeCalc';
import type { CsvImportBericht } from '../infra/csvExport';
import { getSetPriceHistory } from '../finanzen/priceHistory';
import * as repo from './repository/setDetail';
import { versuche } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

/** Im Zustand des Bestands. null: kein Set im Blickfeld. */
export async function setPreis(sk: SetsKontext, uid: number, blickfeldWahl: Sicht | number[], sn: string) {
  const blickfeld = await blickfeldAus(blickfeldWahl);
  const set = await repo.setImFeld(sk.db, sn, blickfeld);
  if (!set) return null;
  // Die Währung aus der Einstellung: Die App schickte ihren lokalen Startwert mit, bevor sie die Einstellung
  // kannte.
  const currency = await getSetting(uid, 'currency', 'EUR');
  const guideType = await getSetting(uid, 'price_guide_type', 'sold');
  const ttlHours = await getSetting(uid, 'price_cache_ttl', '24');
  const preis = await versuche('sets:preis', async () =>
    fetchPrice(sn, await resolveSetCondition(blickfeld, sn), guideType, currency, ttlHours),
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
export async function waehrungVon(uid: number): Promise<string> {
  return String(await getSetting(uid, 'currency', 'EUR'));
}

export function setAlarmeLesen(uid: number, sn: string) {
  return alarmeFuer(uid, normalizeSetNumber(sn));
}

export async function alarmDesSetsSetzen(uid: number, sn: string, eingabe: Parameters<typeof setzeAlarm>[3]) {
  return setzeAlarm(uid, normalizeSetNumber(sn), await waehrungVon(uid), eingabe);
}

export function alarmDesSetsLoeschen(uid: number, sn: string, condition: Zustand | undefined) {
  return loescheAlarm(uid, normalizeSetNumber(sn), condition ?? 'N');
}

export async function alarmCsvImportStarten(uid: number, text: string) {
  return importAlsAuftrag<CsvImportBericht>(uid, 'alarme_csv', { waehrung: await waehrungVon(uid), text });
}

export async function setPreisVerlauf(uid: number, sicht: Sicht | number[], sn: string) {
  return getSetPriceHistory(sicht, sn, await waehrungVon(uid));
}
