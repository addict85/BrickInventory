/** Verwalteraktionen an fremden Konten: Änderung und Protokolleintrag in einer
 * Transaktion. Ein fehlender Eintrag verschwiege die Änderung, ein Eintrag ohne
 * Änderung behauptete eine, die nie geschah. */
import { LETZTER_VERWALTER, setzeAktiv, setzeVerwalterRolle } from './konten';
import { mitZugangsende } from './zugangsende';
import { schalteAb } from './zweiterFaktor';
import { protokolliere } from './verwalterProtokoll';
import { kontoBereich } from './prozess';

type Ergebnis = { geaendert: boolean } | typeof LETZTER_VERWALTER | null;
const geaendert = (r: Ergebnis): r is { geaendert: true } => !!r && r !== LETZTER_VERWALTER && r.geaendert;

export function verwalterRolleSetzen(durch: number, ziel: number, soll: boolean): Promise<Ergebnis> {
  return mitZugangsende(ziel, async () => {
    const r = await setzeVerwalterRolle(ziel, soll);
    if (geaendert(r)) await protokolliere(durch, ziel, soll ? 'verwalter_ernannt' : 'verwalter_entzogen');
    return r;
  });
}

export function aktivSetzen(durch: number, ziel: number, soll: boolean): Promise<Ergebnis> {
  return mitZugangsende(ziel, async () => {
    const r = await setzeAktiv(ziel, soll);
    if (geaendert(r)) await protokolliere(durch, ziel, soll ? 'konto_reaktiviert' : 'konto_deaktiviert');
    return r;
  });
}

export function registrierungFreischalten(durch: number, ziel: number) {
  return kontoBereich().db.transaction(async () => {
    const r = await kontoBereich().konten.schalteRegistrierungFrei(ziel);
    if (r === 'ok') await protokolliere(durch, ziel, 'konto_freigeschaltet');
    return r;
  });
}

export function zweitenFaktorEntfernen(durch: number, ziel: number): Promise<void> {
  return kontoBereich().db.transaction(async () => {
    await schalteAb(ziel);
    await protokolliere(durch, ziel, 'zweiter_faktor_entfernt');
  });
}
