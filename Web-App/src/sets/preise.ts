/** Marktpreis, Preisverlauf und Preisalarm eines Sets. */
import { blickfeldAus, type Sicht } from '../haushalt';
import { einstellungMitZugang } from '../einstellungen';
import { alarmeFuer, loescheAlarm, setzeAlarm, fetchPrice, resolveSetCondition, getSetPriceHistory } from '../finanzen';
import { importAlsAuftrag } from '../auftraege';
import { normalizeSetNumber } from './erfassen';
import type { Zustand } from '../infra/validate';
import type { CsvImportBericht } from '../infra/csvExport';
import * as repo from './repository/setDetail';
import { versuche } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

/** Im Zustand des Bestands. null: kein Set im Blickfeld. */
export async function setPreis(sk: SetsKontext, uid: number, blickfeldWahl: Sicht | number[], sn: string) {
  const blickfeld = await blickfeldAus(sk.db, blickfeldWahl);
  const set = await repo.setImFeld(sk.db, sn, blickfeld);
  if (!set) return null;
  // Die Währung aus der Einstellung: Die App schickte ihren lokalen Startwert mit, bevor sie die Einstellung
  // kannte.
  const currency = await waehrungVon(sk, uid);
  const guideType = String(await einstellungMitZugang(sk.db, uid, 'price_guide_type', 'sold'));
  const ttlHours = String(await einstellungMitZugang(sk.db, uid, 'price_cache_ttl', '24'));
  const preis = await versuche('sets:preis', async () =>
    fetchPrice(
      sn,
      await resolveSetCondition(blickfeld, sn, undefined, sk.finanzen),
      guideType,
      currency,
      ttlHours,
      null,
      {
        finanzen: sk.finanzen,
        katalog: sk.katalog,
      },
    ),
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
export async function waehrungVon(sk: SetsKontext, uid: number): Promise<string> {
  return String(await einstellungMitZugang(sk.db, uid, 'currency', 'EUR'));
}

export function setAlarmeLesen(sk: SetsKontext, uid: number, sn: string) {
  return alarmeFuer(sk.db, uid, normalizeSetNumber(sn));
}

export async function alarmDesSetsSetzen(
  sk: SetsKontext,
  uid: number,
  sn: string,
  eingabe: Parameters<typeof setzeAlarm>[4],
) {
  return setzeAlarm(sk.db, uid, normalizeSetNumber(sn), await waehrungVon(sk, uid), eingabe);
}

export function alarmDesSetsLoeschen(sk: SetsKontext, uid: number, sn: string, condition: Zustand | undefined) {
  return loescheAlarm(sk.db, uid, normalizeSetNumber(sn), condition ?? 'N');
}

export async function alarmCsvImportStarten(sk: SetsKontext, uid: number, text: string) {
  return importAlsAuftrag<CsvImportBericht>(
    uid,
    'alarme_csv',
    { waehrung: await waehrungVon(sk, uid), text },
    {},
    sk.auftraege,
  );
}

export async function setPreisVerlauf(sk: SetsKontext, uid: number, sicht: Sicht | number[], sn: string) {
  return getSetPriceHistory(sicht, sn, await waehrungVon(sk, uid), sk.finanzen);
}
