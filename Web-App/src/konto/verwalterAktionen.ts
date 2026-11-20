/** Verwalteraktionen an fremden Konten: Änderung und Protokolleintrag in einer
 * Transaktion. Ein fehlender Eintrag verschwiege die Änderung, ein Eintrag ohne
 * Änderung behauptete eine, die nie geschah. */
import crypto from 'node:crypto';
import { accountDisplayName, setzeAktiv, setForeignPassword, setzeVerwalterRolle, endAccesses } from './konten';
import { withAccessEnd, accessTransaction } from './zugangsende';
import { duplicateAs, fachfehler } from '../infra/fehlerTexte';
import { rememberAdminAction } from './verwalterProtokoll';
import { hintInBackground, adminHintInBackground } from './kontoHinweis';
import { hashePassword } from './passwortHash';
import { forgetSessionVersion } from './sitzungsVersion';
import { tokenDigest } from './geraeteToken';
import { kontoEntfernen } from './kontoEntfernen';
import { anmeldungFreigeben } from './loginLimiter';
import type { Uebernahme, TakeoverKind } from './repository/uebernahmen';
import type { AccountContext } from './kontext';

export function writeRole(k: AccountContext, durch: number, ziel: number, soll: boolean) {
  return withAccessEnd(k, ziel, async t => {
    const r = await setzeVerwalterRolle(t, ziel, soll);
    if (r.geaendert) await rememberAdminAction(t, durch, ziel, soll ? 'verwalter_ernannt' : 'verwalter_entzogen');
    return r;
  });
}

export function persistActive(k: AccountContext, durch: number, ziel: number, soll: boolean) {
  return withAccessEnd(k, ziel, async t => {
    const r = await setzeAktiv(t, ziel, soll);
    if (r.geaendert) await rememberAdminAction(t, durch, ziel, soll ? 'konto_reaktiviert' : 'konto_deaktiviert');
    return r;
  });
}

export async function verwalterRolleSetzen(k: AccountContext, durch: number, ziel: number, soll: boolean) {
  const effectiveAb = soll ? null : await announceTeardown(k, durch, ziel, 'rolle_entziehen');
  return effectiveAb ? { geaendert: false, effectiveAb } : { ...(await writeRole(k, durch, ziel, soll)), effectiveAb };
}

/** Ein aktiver Verwalter wird erst nach der Frist deaktiviert; ein schon deaktiviertes Konto bleibt es. */
export async function aktivSetzen(k: AccountContext, durch: number, ziel: number, soll: boolean) {
  const aktiv = !soll && (await k.konten.accountFull(ziel))?.is_active === true;
  const effectiveAb = aktiv ? await announceTeardown(k, durch, ziel, 'deaktivieren') : null;
  return effectiveAb
    ? { geaendert: false, effectiveAb }
    : { ...(await persistActive(k, durch, ziel, soll)), effectiveAb };
}

/** Löschen durch einen Verwalter: bei einem Verwalter erst nach der Frist; das eigene Konto sofort. */
export async function accountRemoveBy(k: AccountContext, ziel: number, durch: number | null): Promise<Date | null> {
  const fremd = durch !== null && durch !== ziel && (await k.konten.accountExists(ziel));
  const effectiveAb = fremd ? await announceTeardown(k, durch, ziel, 'loeschen') : null;
  if (!effectiveAb) await kontoEntfernen(k, ziel, durch);
  return effectiveAb;
}

/** 23505 heisst: Ein anderes Konto hat die Adresse gleichzeitig bekommen. */
export async function unlockRegistration(k: AccountContext, durch: number, ziel: number): Promise<void> {
  const r = await accessTransaction(k, async t => {
    const r = await t.konten.switchRegistrationFree(ziel);
    if (r === 'ok') await rememberAdminAction(t, durch, ziel, 'konto_freigeschaltet');
    return r;
  }).catch(duplicateAs('vergeben' as const));
  if (r !== 'ok') fachfehler('konflikt', r === 'vergeben' ? 'email_vergeben' : 'konto_nicht_wartend');
}

/** Wer den Faktor verlor, war vielleicht nicht der, der ihn entfernen liess: Sitzungen und Tokens enden mit. */
export function removeSecondFactor(k: AccountContext, durch: number, ziel: number): Promise<void> {
  return withAccessEnd(k, ziel, async t => {
    await t.factors.disable(ziel);
    await endAccesses(t, ziel);
    await rememberAdminAction(t, durch, ziel, 'zweiter_faktor_entfernt');
  });
}

/** Eine erbeutete Verwaltersitzung soll kein anderes Verwalterkonto sofort übernehmen oder abräumen: Erst
 * nach TAKEOVER_HOURS; eine Anmeldung des Ziels oder der Link aus seiner Mail hebt die Änderung auf. */
export const TAKEOVER_HOURS = 24;
type Verwalterweg = { effectiveAb: Date | null };
export type Teardown = Extract<TakeoverKind, 'deaktivieren' | 'rolle_entziehen' | 'loeschen'>;
const isTakeover = (a: TakeoverKind) => a === 'passwort' || a === 'zweiter_faktor';

export async function passwordByAdmin(
  k: AccountContext,
  durch: number,
  ziel: number,
  passwort: string,
): Promise<Verwalterweg | null> {
  if (await k.uebernahmen.adminOrJustBeen(ziel, TAKEOVER_HOURS)) {
    const password_hash = await hashePassword(passwort);
    return {
      effectiveAb: await announce(k, { target_id: ziel, type: 'passwort', initiated_by: durch, password_hash }),
    };
  }
  if (!(await setForeignPassword(k, ziel, passwort, durch))) return null;
  await afterTheTakeover(k, { target_id: ziel, type: 'passwort', initiated_by: durch, password_hash: null });
  return { effectiveAb: null };
}

export async function factorByAdmin(k: AccountContext, durch: number, ziel: number): Promise<Verwalterweg> {
  const u: Uebernahme = { target_id: ziel, type: 'zweiter_faktor', initiated_by: durch, password_hash: null };
  if (await k.uebernahmen.adminOrJustBeen(ziel, TAKEOVER_HOURS)) return { effectiveAb: await announce(k, u) };
  await removeSecondFactor(k, durch, ziel);
  await afterTheTakeover(k, u);
  return { effectiveAb: null };
}

/** Deaktivieren, Rolle entziehen oder Löschen eines Verwalters (oder eben gewesenen) ankündigen.
 * @returns ab wann es gilt, oder null: Das Ziel ist kein Verwalter, der Aufrufer handelt sofort. */
async function announceTeardown(k: AccountContext, durch: number, ziel: number, type: Teardown): Promise<Date | null> {
  const verwalter =
    type === 'rolle_entziehen'
      ? (await k.konten.accountShort(ziel))?.is_admin === true
      : await k.uebernahmen.adminOrJustBeen(ziel, TAKEOVER_HOURS);
  return verwalter ? announce(k, { target_id: ziel, type, initiated_by: durch, password_hash: null }) : null;
}

async function announce(k: AccountContext, u: Uebernahme): Promise<Date> {
  const abbruch = crypto.randomBytes(32).toString('base64url');
  const bis = await accessTransaction(k, async t => {
    const b = await t.uebernahmen.terminateAn(u, TAKEOVER_HOURS, tokenDigest(abbruch));
    await rememberAdminAction(t, u.initiated_by, u.target_id, 'uebernahme_angekuendigt', u.type);
    return b;
  });
  const angaben = { durch: await accountDisplayName(k, u.initiated_by), was: u.type, bis: bis.toISOString() };
  // Den Link bekommt nur das Ziel: Mit ihm bricht es ab, auch deaktiviert und ohne Anmeldung.
  hintInBackground(k, u.target_id, 'uebernahme_angekuendigt', undefined, { ...angaben, abbruch });
  adminHintInBackground(k, 'verwaltung_uebernahme_angekuendigt', {
    ...angaben,
    konto: await accountDisplayName(k, u.target_id),
  });
  return bis;
}

async function afterTheTakeover(k: AccountContext, u: Uebernahme): Promise<void> {
  const [durch, konto] = [await accountDisplayName(k, u.initiated_by), await accountDisplayName(k, u.target_id)];
  const pw = u.type === 'passwort';
  hintInBackground(k, u.target_id, pw ? 'passwort_durch_verwalter' : 'zweiter_faktor_entfernt', undefined, { durch });
  adminHintInBackground(k, pw ? 'verwaltung_passwort_gesetzt' : 'verwaltung_faktor_entfernt', { konto, durch });
}

async function executeTeardown(k: AccountContext, u: Uebernahme): Promise<void> {
  const [durch, konto] = [await accountDisplayName(k, u.initiated_by), await accountDisplayName(k, u.target_id)];
  if (u.type === 'deaktivieren') await persistActive(k, u.initiated_by, u.target_id, false);
  else if (u.type === 'rolle_entziehen') await writeRole(k, u.initiated_by, u.target_id, false);
  else await kontoEntfernen(k, u.target_id, u.initiated_by);
  if (u.type !== 'loeschen')
    hintInBackground(k, u.target_id, 'verwalter_aktion_ausgefuehrt', undefined, { durch, was: u.type });
  adminHintInBackground(k, 'verwaltung_aktion_ausgefuehrt', { konto, durch, was: u.type });
}

/** Der Aufräumlauf (stündlich): fällige Ankündigungen, solange ihr Verwalter noch einer ist. */
export async function runDueTakeoversFrom(k: AccountContext): Promise<number> {
  const { erledigt, teardown } = await withAccessEnd(
    k,
    () => null,
    async t => {
      const { gilt } = await t.uebernahmen.takeDue();
      const erledigt = gilt.filter(u => isTakeover(u.type));
      for (const u of erledigt) {
        if (u.password_hash) await t.konten.setPasswordHash(u.target_id, u.password_hash);
        else await t.factors.disable(u.target_id);
        await endAccesses(t, u.target_id);
        await rememberAdminAction(
          t,
          u.initiated_by,
          u.target_id,
          u.password_hash ? 'passwort_gesetzt' : 'zweiter_faktor_entfernt',
        );
      }
      return { erledigt, teardown: gilt.filter(u => !isTakeover(u.type)) };
    },
  );
  for (const u of erledigt) {
    forgetSessionVersion(k, u.target_id);
    await afterTheTakeover(k, u);
  }
  // Löschen zuletzt; ein Fehlschlag (letzter Verwalter) hält die übrigen nicht auf, der Lauf meldet ihn.
  const fehler: unknown[] = [];
  for (const u of teardown.sort((a, b) => Number(a.type === 'loeschen') - Number(b.type === 'loeschen')))
    await executeTeardown(k, u).catch((e: unknown) => fehler.push(e));
  if (fehler.length) throw new AggregateError(fehler, `${fehler.length} angekündigte Verwalteraktion(en) gescheitert`);
  return erledigt.length + teardown.length;
}

/** Nach jeder Anmeldung: Wer sich anmelden kann, braucht keinen Neuanfang durch einen anderen Verwalter. */
export async function cancelTakeovers(
  k: AccountContext,
  uid: number,
  weg: 'anmeldung' | 'link' = 'anmeldung',
): Promise<TakeoverKind[]> {
  const arten = await k.uebernahmen.abortTakeoversAb(uid);
  if (!arten.length) return arten;
  for (const type of arten) await rememberAdminAction(k, uid, uid, 'uebernahme_abgebrochen', `${weg}:${type}`);
  adminHintInBackground(k, 'verwaltung_uebernahme_abgebrochen', {
    konto: await accountDisplayName(k, uid),
    was: arten.join(', '),
  });
  return arten;
}

/** Die Links aus Mails an den Inhaber, ohne Anmeldung; ein Abbruch gilt einmal, weil er die Zeilen löscht. */
export async function redeemMailLink(k: AccountContext, type: 'abbrechen' | 'freigeben', token: string): Promise<void> {
  if (type === 'freigeben') return anmeldungFreigeben(k, token);
  const ziel = token ? await k.uebernahmen.targetToAbort(tokenDigest(token)) : null;
  if (ziel === null) fachfehler('konflikt', 'abbruch_link_ungueltig');
  await cancelTakeovers(k, ziel, 'link');
}
