/** Verwalteraktionen an fremden Konten: Änderung und Protokolleintrag in einer
 * Transaktion. Ein fehlender Eintrag verschwiege die Änderung, ein Eintrag ohne
 * Änderung behauptete eine, die nie geschah. */
import { LETZTER_VERWALTER, setzeAktiv, setzeVerwalterRolle } from './konten';
import { mitZugangsende } from './zugangsende';
import { schalteAb } from './zweiterFaktor';
import { verwalterAktionMerken } from './verwalterProtokoll';
import type { KontoKontext } from './kontext';

type Ergebnis = { geaendert: boolean } | typeof LETZTER_VERWALTER | null;
const geaendert = (r: Ergebnis): r is { geaendert: true } => !!r && r !== LETZTER_VERWALTER && r.geaendert;

export function verwalterRolleSetzen(k: KontoKontext, durch: number, ziel: number, soll: boolean): Promise<Ergebnis> {
  return mitZugangsende(k, ziel, async t => {
    const r = await setzeVerwalterRolle(t, ziel, soll);
    if (geaendert(r)) await verwalterAktionMerken(t, durch, ziel, soll ? 'verwalter_ernannt' : 'verwalter_entzogen');
    return r;
  });
}

export function aktivSetzen(k: KontoKontext, durch: number, ziel: number, soll: boolean): Promise<Ergebnis> {
  return mitZugangsende(k, ziel, async t => {
    const r = await setzeAktiv(t, ziel, soll);
    if (geaendert(r)) await verwalterAktionMerken(t, durch, ziel, soll ? 'konto_reaktiviert' : 'konto_deaktiviert');
    return r;
  });
}

export function registrierungFreischalten(k: KontoKontext, durch: number, ziel: number) {
  return k.transaktion(async t => {
    const r = await t.konten.schalteRegistrierungFrei(ziel);
    if (r === 'ok') await verwalterAktionMerken(t, durch, ziel, 'konto_freigeschaltet');
    return r;
  });
}

export function zweitenFaktorEntfernen(k: KontoKontext, durch: number, ziel: number): Promise<void> {
  return k.transaktion(async t => {
    await schalteAb(t, ziel);
    await verwalterAktionMerken(t, durch, ziel, 'zweiter_faktor_entfernt');
  });
}
