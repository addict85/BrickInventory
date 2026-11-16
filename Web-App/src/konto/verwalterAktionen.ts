/** Verwalteraktionen an fremden Konten: Änderung und Protokolleintrag in einer
 * Transaktion. Ein fehlender Eintrag verschwiege die Änderung, ein Eintrag ohne
 * Änderung behauptete eine, die nie geschah. */
import crypto from 'node:crypto';
import { kontoAnzeigeName, setzeAktiv, setzeFremdesPasswort, setzeVerwalterRolle, zugaengeBeenden } from './konten';
import { mitZugangsende, zugangsTransaktion } from './zugangsende';
import { doppeltAls, fachfehler } from '../infra/fehlerTexte';
import { verwalterAktionMerken } from './verwalterProtokoll';
import { hinweisNebenher, verwalterHinweisNebenher } from './kontoHinweis';
import { hashePasswort } from './passwortHash';
import { vergissSitzungsVersion } from './sitzungsVersion';
import { tokenAbdruck } from './geraeteToken';
import { kontoEntfernen } from './kontoEntfernen';
import { anmeldungFreigeben } from './loginLimiter';
import type { Uebernahme, UebernahmeArt } from './repository/uebernahmen';
import type { KontoKontext } from './kontext';

export function rolleSchreiben(k: KontoKontext, durch: number, ziel: number, soll: boolean) {
  return mitZugangsende(k, ziel, async t => {
    const r = await setzeVerwalterRolle(t, ziel, soll);
    if (r.geaendert) await verwalterAktionMerken(t, durch, ziel, soll ? 'verwalter_ernannt' : 'verwalter_entzogen');
    return r;
  });
}

export function aktivSchreiben(k: KontoKontext, durch: number, ziel: number, soll: boolean) {
  return mitZugangsende(k, ziel, async t => {
    const r = await setzeAktiv(t, ziel, soll);
    if (r.geaendert) await verwalterAktionMerken(t, durch, ziel, soll ? 'konto_reaktiviert' : 'konto_deaktiviert');
    return r;
  });
}

export async function verwalterRolleSetzen(k: KontoKontext, durch: number, ziel: number, soll: boolean) {
  const wirksamAb = soll ? null : await abbauAnkuendigen(k, durch, ziel, 'rolle_entziehen');
  return wirksamAb ? { geaendert: false, wirksamAb } : { ...(await rolleSchreiben(k, durch, ziel, soll)), wirksamAb };
}

/** Ein aktiver Verwalter wird erst nach der Frist deaktiviert; ein schon deaktiviertes Konto bleibt es. */
export async function aktivSetzen(k: KontoKontext, durch: number, ziel: number, soll: boolean) {
  const aktiv = !soll && (await k.konten.kontoVoll(ziel))?.is_active === true;
  const wirksamAb = aktiv ? await abbauAnkuendigen(k, durch, ziel, 'deaktivieren') : null;
  return wirksamAb ? { geaendert: false, wirksamAb } : { ...(await aktivSchreiben(k, durch, ziel, soll)), wirksamAb };
}

/** Löschen durch einen Verwalter: bei einem Verwalter erst nach der Frist; das eigene Konto sofort. */
export async function kontoEntfernenDurch(k: KontoKontext, ziel: number, durch: number | null): Promise<Date | null> {
  const fremd = durch !== null && durch !== ziel && (await k.konten.kontoExistiert(ziel));
  const wirksamAb = fremd ? await abbauAnkuendigen(k, durch, ziel, 'loeschen') : null;
  if (!wirksamAb) await kontoEntfernen(k, ziel, durch);
  return wirksamAb;
}

/** 23505 heisst: Ein anderes Konto hat die Adresse gleichzeitig bekommen. */
export async function registrierungFreischalten(k: KontoKontext, durch: number, ziel: number): Promise<void> {
  const r = await zugangsTransaktion(k, async t => {
    const r = await t.konten.schalteRegistrierungFrei(ziel);
    if (r === 'ok') await verwalterAktionMerken(t, durch, ziel, 'konto_freigeschaltet');
    return r;
  }).catch(doppeltAls('vergeben' as const));
  if (r !== 'ok') fachfehler('konflikt', r === 'vergeben' ? 'email_vergeben' : 'konto_nicht_wartend');
}

/** Wer den Faktor verlor, war vielleicht nicht der, der ihn entfernen liess: Sitzungen und Tokens enden mit. */
export function zweitenFaktorEntfernen(k: KontoKontext, durch: number, ziel: number): Promise<void> {
  return mitZugangsende(k, ziel, async t => {
    await t.faktoren.schalteAb(ziel);
    await zugaengeBeenden(t, ziel);
    await verwalterAktionMerken(t, durch, ziel, 'zweiter_faktor_entfernt');
  });
}

/** Eine erbeutete Verwaltersitzung soll kein anderes Verwalterkonto sofort übernehmen oder abräumen: Erst
 * nach UEBERNAHME_STUNDEN; eine Anmeldung des Ziels oder der Link aus seiner Mail hebt die Änderung auf. */
export const UEBERNAHME_STUNDEN = 24;
type Verwalterweg = { wirksamAb: Date | null };
export type Abbau = Extract<UebernahmeArt, 'deaktivieren' | 'rolle_entziehen' | 'loeschen'>;
const istUebernahme = (a: UebernahmeArt) => a === 'passwort' || a === 'zweiter_faktor';

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

/** Deaktivieren, Rolle entziehen oder Löschen eines Verwalters (oder eben gewesenen) ankündigen.
 * @returns ab wann es gilt, oder null: Das Ziel ist kein Verwalter, der Aufrufer handelt sofort. */
async function abbauAnkuendigen(k: KontoKontext, durch: number, ziel: number, art: Abbau): Promise<Date | null> {
  const verwalter =
    art === 'rolle_entziehen'
      ? (await k.konten.kontoKurz(ziel))?.is_admin === true
      : await k.uebernahmen.verwalterOderEbenGewesen(ziel, UEBERNAHME_STUNDEN);
  return verwalter ? ankuendigen(k, { ziel_id: ziel, art, durch_id: durch, passwort_hash: null }) : null;
}

async function ankuendigen(k: KontoKontext, u: Uebernahme): Promise<Date> {
  const abbruch = crypto.randomBytes(32).toString('base64url');
  const bis = await zugangsTransaktion(k, async t => {
    const b = await t.uebernahmen.kuendigeAn(u, UEBERNAHME_STUNDEN, tokenAbdruck(abbruch));
    await verwalterAktionMerken(t, u.durch_id, u.ziel_id, 'uebernahme_angekuendigt', u.art);
    return b;
  });
  const angaben = { durch: await kontoAnzeigeName(k, u.durch_id), was: u.art, bis: bis.toISOString() };
  // Den Link bekommt nur das Ziel: Mit ihm bricht es ab, auch deaktiviert und ohne Anmeldung.
  hinweisNebenher(k, u.ziel_id, 'uebernahme_angekuendigt', undefined, { ...angaben, abbruch });
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

async function abbauAusfuehren(k: KontoKontext, u: Uebernahme): Promise<void> {
  const [durch, konto] = [await kontoAnzeigeName(k, u.durch_id), await kontoAnzeigeName(k, u.ziel_id)];
  if (u.art === 'deaktivieren') await aktivSchreiben(k, u.durch_id, u.ziel_id, false);
  else if (u.art === 'rolle_entziehen') await rolleSchreiben(k, u.durch_id, u.ziel_id, false);
  else await kontoEntfernen(k, u.ziel_id, u.durch_id);
  if (u.art !== 'loeschen')
    hinweisNebenher(k, u.ziel_id, 'verwalter_aktion_ausgefuehrt', undefined, { durch, was: u.art });
  verwalterHinweisNebenher(k, 'verwaltung_aktion_ausgefuehrt', { konto, durch, was: u.art });
}

/** Der Aufräumlauf (stündlich): fällige Ankündigungen, solange ihr Verwalter noch einer ist. */
export async function fuehreFaelligeUebernahmenAus(k: KontoKontext): Promise<number> {
  const { erledigt, abbau } = await mitZugangsende(
    k,
    () => null,
    async t => {
      const { gilt } = await t.uebernahmen.nimmFaellige();
      const erledigt = gilt.filter(u => istUebernahme(u.art));
      for (const u of erledigt) {
        if (u.passwort_hash) await t.konten.setzePasswortHash(u.ziel_id, u.passwort_hash);
        else await t.faktoren.schalteAb(u.ziel_id);
        await zugaengeBeenden(t, u.ziel_id);
        await verwalterAktionMerken(
          t,
          u.durch_id,
          u.ziel_id,
          u.passwort_hash ? 'passwort_gesetzt' : 'zweiter_faktor_entfernt',
        );
      }
      return { erledigt, abbau: gilt.filter(u => !istUebernahme(u.art)) };
    },
  );
  for (const u of erledigt) {
    vergissSitzungsVersion(k, u.ziel_id);
    await nachDerUebernahme(k, u);
  }
  // Löschen zuletzt; ein Fehlschlag (letzter Verwalter) hält die übrigen nicht auf, der Lauf meldet ihn.
  const fehler: unknown[] = [];
  for (const u of abbau.sort((a, b) => Number(a.art === 'loeschen') - Number(b.art === 'loeschen')))
    await abbauAusfuehren(k, u).catch((e: unknown) => fehler.push(e));
  if (fehler.length) throw new AggregateError(fehler, `${fehler.length} angekündigte Verwalteraktion(en) gescheitert`);
  return erledigt.length + abbau.length;
}

/** Nach jeder Anmeldung: Wer sich anmelden kann, braucht keinen Neuanfang durch einen anderen Verwalter. */
export async function uebernahmenAbbrechen(
  k: KontoKontext,
  uid: number,
  weg: 'anmeldung' | 'link' = 'anmeldung',
): Promise<UebernahmeArt[]> {
  const arten = await k.uebernahmen.brichUebernahmenAb(uid);
  if (!arten.length) return arten;
  for (const art of arten) await verwalterAktionMerken(k, uid, uid, 'uebernahme_abgebrochen', `${weg}:${art}`);
  verwalterHinweisNebenher(k, 'verwaltung_uebernahme_abgebrochen', {
    konto: await kontoAnzeigeName(k, uid),
    was: arten.join(', '),
  });
  return arten;
}

/** Die Links aus Mails an den Inhaber, ohne Anmeldung; ein Abbruch gilt einmal, weil er die Zeilen löscht. */
export async function mailLinkEinloesen(k: KontoKontext, art: 'abbrechen' | 'freigeben', token: string): Promise<void> {
  if (art === 'freigeben') return anmeldungFreigeben(k, token);
  const ziel = token ? await k.uebernahmen.zielZumAbbruch(tokenAbdruck(token)) : null;
  if (ziel === null) fachfehler('konflikt', 'abbruch_link_ungueltig');
  await uebernahmenAbbrechen(k, ziel, 'link');
}
