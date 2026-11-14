/** Marktpreis, Preisverlauf und Preisalarm eines Sets. */
import type { Sicht } from '../haushalt';
import { einstellungMitZugang } from '../einstellungen';
import { normalisiereSetNummer } from '../infra/setNummer';
import type { Zustand } from '../infra/validate';
import type { CsvImportBericht } from '../infra/csvExport';
import * as repo from './repository/setDetail';
import { versuche } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

/** Im Zustand des Bestands. null: kein Set im Blickfeld. */
export async function setPreis(sk: SetsKontext, uid: number, blickfeldWahl: Sicht | number[], sn: string) {
  const blickfeld = await sk.haushalt.blickfeldAus(blickfeldWahl);
  const set = await repo.setImFeld(sk.db, sn, blickfeld);
  if (!set) return null;
  // Die Währung aus der Einstellung: Die App schickte ihren lokalen Startwert mit, bevor sie die Einstellung
  // kannte.
  const currency = await waehrungVon(sk, uid);
  const guideType = String(await einstellungMitZugang(sk.db, uid, 'price_guide_type', 'sold'));
  const ttlHours = String(await einstellungMitZugang(sk.db, uid, 'price_cache_ttl', '24'));
  const preis = await versuche('sets:preis', async () =>
    sk.finanzen.fetchPrice(
      sn,
      await sk.finanzen.resolveSetCondition(blickfeld, sn),
      guideType,
      currency,
      ttlHours,
      null,
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
  return sk.finanzen.preisalarm.alarmeFuer(uid, normalisiereSetNummer(sn));
}

export async function alarmDesSetsSetzen(
  sk: SetsKontext,
  uid: number,
  sn: string,
  eingabe: Parameters<SetsKontext['finanzen']['preisalarm']['setzeAlarm']>[3],
) {
  return sk.finanzen.preisalarm.setzeAlarm(uid, normalisiereSetNummer(sn), await waehrungVon(sk, uid), eingabe);
}

export function alarmDesSetsLoeschen(sk: SetsKontext, uid: number, sn: string, condition: Zustand | undefined) {
  return sk.finanzen.preisalarm.loescheAlarm(uid, normalisiereSetNummer(sn), condition ?? 'N');
}

export async function alarmCsvImportStarten(sk: SetsKontext, uid: number, text: string) {
  return sk.auftraege.importAlsAuftrag<CsvImportBericht>(
    uid,
    'alarme_csv',
    { waehrung: await waehrungVon(sk, uid), text },
    {},
  );
}

export async function setPreisVerlauf(sk: SetsKontext, uid: number, sicht: Sicht | number[], sn: string) {
  return sk.finanzen.preisverlaufSet(sicht, sn, await waehrungVon(sk, uid));
}
