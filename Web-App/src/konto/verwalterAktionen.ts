/** Verwalteraktionen an fremden Konten: Änderung und Protokolleintrag in einer
 * Transaktion. Ein fehlender Eintrag verschwiege die Änderung, ein Eintrag ohne
 * Änderung behauptete eine, die nie geschah. */
import {
  LETZTER_VERWALTER,
  kontoAnzeigeName,
  setzeAktiv,
  setzeFremdesPasswort,
  setzeVerwalterRolle,
  zugaengeBeenden,
} from './konten';
import { mitZugangsende, zugangsTransaktion } from './zugangsende';
import { doppeltAls } from '../infra/fehlerTexte';
import { schalteAb } from './zweiterFaktor';
import { verwalterAktionMerken } from './verwalterProtokoll';
import { hinweisNebenher, verwalterHinweisNebenher } from './kontoHinweis';
import { hashePasswort } from './passwortHash';
import { vergissSitzungsVersion } from './sitzungsVersion';
import type { Uebernahme, UebernahmeArt } from './repository/uebernahmen';
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

/** 23505 heisst: Ein anderes Konto hat die Adresse gleichzeitig bekommen. */
export function registrierungFreischalten(k: KontoKontext, durch: number, ziel: number) {
  return zugangsTransaktion(k, async t => {
    const r = await t.konten.schalteRegistrierungFrei(ziel);
    if (r === 'ok') await verwalterAktionMerken(t, durch, ziel, 'konto_freigeschaltet');
    return r;
  }).catch(doppeltAls('vergeben' as const));
}

/** Wer den Faktor verlor, war vielleicht nicht der, der ihn entfernen liess: Sitzungen und Tokens enden mit. */
export function zweitenFaktorEntfernen(k: KontoKontext, durch: number, ziel: number): Promise<void> {
  return mitZugangsende(k, ziel, async t => {
    await schalteAb(t, ziel);
    await zugaengeBeenden(t, ziel);
    await verwalterAktionMerken(t, durch, ziel, 'zweiter_faktor_entfernt');
  });
}

/** Eine erbeutete Verwaltersitzung soll kein anderes Verwalterkonto sofort übernehmen: Bei
 * Verwaltern gilt die Änderung erst nach UEBERNAHME_STUNDEN, und eine Anmeldung des Ziels hebt sie auf. */
export const UEBERNAHME_STUNDEN = 24;
type Verwalterweg = { wirksamAb: Date | null };

export async function passwortDurchVerwalter(
  k: KontoKontext,
  durch: number,
  ziel: number,
  passwort: string,
): Promise<Verwalterweg | null> {
  if (await k.uebernahmen.verwalterOderEbenGewesen(ziel, UEBERNAHME_STUNDEN)) {
    const passwort_hash = await hashePasswort(passwort);
    return { wirksamAb: await ankuendigen(k, { ziel_id: ziel, art: 'passwort', durch_id: durch, passwort_hash }) };
  }
  if (!(await setzeFremdesPasswort(k, ziel, passwort, durch))) return null;
  await nachDerUebernahme(k, { ziel_id: ziel, art: 'passwort', durch_id: durch, passwort_hash: null });
  return { wirksamAb: null };
}

export async function faktorDurchVerwalter(k: KontoKontext, durch: number, ziel: number): Promise<Verwalterweg> {
  const u: Uebernahme = { ziel_id: ziel, art: 'zweiter_faktor', durch_id: durch, passwort_hash: null };
  if (await k.uebernahmen.verwalterOderEbenGewesen(ziel, UEBERNAHME_STUNDEN))
    return { wirksamAb: await ankuendigen(k, u) };
  await zweitenFaktorEntfernen(k, durch, ziel);
  await nachDerUebernahme(k, u);
  return { wirksamAb: null };
}

async function ankuendigen(k: KontoKontext, u: Uebernahme): Promise<Date> {
  const bis = await zugangsTransaktion(k, async t => {
    const b = await t.uebernahmen.kuendigeAn(u, UEBERNAHME_STUNDEN);
    await verwalterAktionMerken(t, u.durch_id, u.ziel_id, 'uebernahme_angekuendigt', u.art);
    return b;
  });
  const angaben = { durch: await kontoAnzeigeName(k, u.durch_id), was: u.art, bis: bis.toISOString() };
  hinweisNebenher(k, u.ziel_id, 'uebernahme_angekuendigt', undefined, angaben);
  verwalterHinweisNebenher(k, 'verwaltung_uebernahme_angekuendigt', {
    ...angaben,
    konto: await kontoAnzeigeName(k, u.ziel_id),
  });
  return bis;
}

async function nachDerUebernahme(k: KontoKontext, u: Uebernahme): Promise<void> {
  const [durch, konto] = [await kontoAnzeigeName(k, u.durch_id), await kontoAnzeigeName(k, u.ziel_id)];
  const pw = u.art === 'passwort';
  hinweisNebenher(k, u.ziel_id, pw ? 'passwort_durch_verwalter' : 'zweiter_faktor_entfernt', undefined, { durch });
  verwalterHinweisNebenher(k, pw ? 'verwaltung_passwort_gesetzt' : 'verwaltung_faktor_entfernt', { konto, durch });
}

/** Der Aufräumlauf (stündlich): fällige Übernahmen, solange ihr Verwalter noch einer ist. */
export async function fuehreFaelligeUebernahmenAus(k: KontoKontext): Promise<number> {
  const erledigt = await mitZugangsende(
    k,
    () => null,
    async t => {
      const { gilt } = await t.uebernahmen.nimmFaellige();
      for (const u of gilt) {
        if (u.passwort_hash) await t.konten.setzePasswortHash(u.ziel_id, u.passwort_hash);
        else await t.zweiterFaktor.entferne(u.ziel_id);
        await zugaengeBeenden(t, u.ziel_id);
        await verwalterAktionMerken(
          t,
          u.durch_id,
          u.ziel_id,
          u.passwort_hash ? 'passwort_gesetzt' : 'zweiter_faktor_entfernt',
        );
      }
      return gilt;
    },
  );
  for (const u of erledigt) {
    vergissSitzungsVersion(k, u.ziel_id);
    await nachDerUebernahme(k, u);
  }
  return erledigt.length;
}

/** Nach jeder Anmeldung: Wer sich anmelden kann, braucht keinen Neuanfang durch einen anderen Verwalter. */
export async function uebernahmenAbbrechen(k: KontoKontext, uid: number): Promise<UebernahmeArt[]> {
  const arten = await k.uebernahmen.brichAb(uid);
  if (!arten.length) return arten;
  for (const art of arten) await verwalterAktionMerken(k, uid, uid, 'uebernahme_abgebrochen', art);
  verwalterHinweisNebenher(k, 'verwaltung_uebernahme_abgebrochen', {
    konto: await kontoAnzeigeName(k, uid),
    was: arten.join(', '),
  });
  return arten;
}
