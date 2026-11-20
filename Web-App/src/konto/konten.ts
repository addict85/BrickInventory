/** Jeder Weg, der ein Passwort ändert, beendet danach alle Zugänge — an einer
 * Stelle, damit kein Weg den Schritt vergisst. */
import { hashePassword } from './passwortHash';
import * as repo from './repository/konten';
import { emptyTokenCache } from './tokenCache';
import { withAccessEnd, endAllSessions, accessTransaction } from './zugangsende';
import { tokenDigest, revokeAllTokens } from './geraeteToken';
import { emailValid } from '../infra/validate';
import { removeStartpasswort } from '../infra/startpasswort';
import { rememberAdminAction } from './verwalterProtokoll';
import { asDuplicate, fachfehler, notFound } from '../infra/fehlerTexte';
import type { ResetSideEffects } from '../mail';
import { hintInBackground } from './kontoHinweis';
import { deleteDailyLimit } from './loginLimiter';
import type { AccountContext } from './kontext';
import type { TakeoverKind } from './repository/uebernahmen';

/** Nur melden, nichts ändern: Welche Adresse gemeint war, weiss nur der Inhaber. */
export async function reportInvalidAddresses(k: AccountContext): Promise<number[]> {
  const ids = (await k.konten.allAddresses()).filter(z => !emailValid(z.email)).map(z => z.id);
  if (ids.length)
    console.warn(
      `⚠️  [konto] ${ids.length} Konto/Konten mit einer E-Mail-Adresse, die keine einzelne reine Adresse ist ` +
        `(IDs ${ids.join(', ')}). An sie geht keine Mail; Adresse im Konto neu eintragen oder das Konto löschen (UPGRADE.md).`,
    );
  return ids;
}

/** H5: Eine Adresse aus dem Altbestand, die nie bestätigt wurde, gilt nicht mehr; der Inhaber muss es wissen. */
export async function reportPendingAddresses(k: AccountContext): Promise<number[]> {
  const ids = await k.konten.pendingWithoutLink();
  if (ids.length)
    console.warn(
      `⚠️  [konto] ${ids.length} Konto/Konten mit einer nie bestätigten Adresse (IDs ${ids.join(', ')}). ` +
        'Sie gilt erst nach Bestätigung; im Profil neu eintragen, dann kommt der Link (UPGRADE.md).',
    );
  return ids;
}

export async function accountsList(k: AccountContext) {
  const konten = await k.konten.allAccounts();
  const withFactor = await k.factors.activeAmong(konten.map(z => z.id));
  // Angekündigte Änderungen an Verwaltern (24 h): Die übrigen Verwalter sollen sie sehen, nicht nur per Mail.
  const angekuendigt = new Map<number, { type: TakeoverKind; effective_at: string }[]>();
  for (const a of await k.uebernahmen.announced())
    angekuendigt.set(a.target_id, [
      ...(angekuendigt.get(a.target_id) ?? []),
      { type: a.type, effective_at: new Date(a.effective_at).toISOString() },
    ]);
  return konten.map(z => ({ ...z, zweiter_faktor: withFactor.has(z.id), angekuendigt: angekuendigt.get(z.id) ?? [] }));
}

export async function profil(k: AccountContext, id: number) {
  return k.konten.profileRow(id);
}

export function accountShortOf(k: AccountContext, id: number) {
  return k.konten.accountShort(id);
}

export function accountFullOf(k: AccountContext, id: number) {
  return k.konten.accountFull(id);
}

export function givesAccount(k: AccountContext, id: number): Promise<boolean> {
  return k.konten.accountExists(id);
}

/** Für Hinweise an Verwalter: Ein gerade gelöschtes Konto heisst wenigstens nach seiner ID. */
export async function accountDisplayName(k: AccountContext, id: number): Promise<string> {
  return (await k.konten.accountShort(id))?.username ?? String(id);
}

/** Verwalterrechte trägt das Passwort allein nicht; ein Passkey ersetzt TOTP hier nicht. */
export async function openFactorRequired(k: AccountContext, uid: number, verwalter: boolean): Promise<boolean> {
  return verwalter && !(await k.factors.isActive(uid));
}

/** Der Schritt „Konto“ der Einrichtung: Es gibt eines, und ein Verwalter hat das Startpasswort ersetzt. */
export async function accountConfigured(k: AccountContext, verwalter: boolean): Promise<boolean> {
  const s = await k.einrichtung.accountsStatus();
  return s.vorhanden && (!verwalter || !s.startpasswort);
}

export function passwordSwitchDue(k: AccountContext, id: number): Promise<boolean> {
  return k.konten.mussPasswortAendern(id);
}

const hashe = (passwort: string) => hashePassword(passwort);

export async function endAccesses(k: AccountContext, uid: number): Promise<void> {
  await revokeAllTokens(k, uid);
  await endAllSessions(k, uid);
}

async function startpasswortDone(k: AccountContext, uid: number): Promise<void> {
  if ((await k.konten.accountShort(uid))?.is_admin) removeStartpasswort();
}

/** Passwort, Zugänge und Protokolleintrag des Verwalters `durch` zusammen oder gar nicht. */
export async function setForeignPassword(
  k: AccountContext,
  uid: number,
  passwort: string,
  durch: number | null = null,
): Promise<boolean> {
  const hash = await hashe(passwort);
  return withAccessEnd(k, uid, async t => {
    if (!(await t.konten.setPasswordHash(uid, hash))) return false;
    await endAccesses(t, uid);
    if (durch !== null) await rememberAdminAction(t, durch, uid, 'passwort_gesetzt');
    return true;
  });
}

/** Auch der gerade benutzte Token fällt. Passkeys nur auf Wunsch: Wer sein
 * Passwort bloss erneuert, soll seine Geräte nicht neu einrichten müssen. */
export async function aendereEigenesPasswort(
  k: AccountContext,
  uid: number,
  passwort: string,
  o: { passkeysWiderrufen?: boolean } = {},
): Promise<void> {
  const hash = await hashe(passwort);
  await withAccessEnd(k, uid, async t => {
    await t.konten.setOwnPassword(uid, hash);
    await endAccesses(t, uid);
    if (o.passkeysWiderrufen) await t.factors.revokePasskeys(uid);
  });
  await startpasswortDone(k, uid);
}

/** Der Link trägt den Token im Klartext; gespeichert ist nur sein Hash. */
export function setPasswordPerLink(k: AccountContext, token: string, passwort: string): Promise<number | null> {
  return setPasswordBack(k, tokenDigest(token), passwort);
}

/** Hier will man einen Eindringling loswerden: Passkeys, Hauptkonten über diesem Konto, offene
 * Einladungen und ein Adresswechsel fallen mit (beim normalen Wechsel nicht: den löst der
 * angemeldete Inhaber aus). @returns das Konto, oder null, wenn der Link schon verbraucht oder abgelaufen ist */
export async function setPasswordBack(k: AccountContext, tokenHash: string, passwort: string): Promise<number | null> {
  const hash = await hashe(passwort);
  const r = await withAccessEnd(
    k,
    (e: { uid: number; resolved: ResetSideEffects } | null) => e?.uid ?? null,
    async t => {
      const uid = (await t.konten.resetSetPasswordAfter(tokenHash, hash))?.id;
      if (!uid) return null;
      await endAccesses(t, uid);
      await t.factors.revokePasskeys(uid);
      const haushalt = await t.haushalt.unlinkForeignAccess(uid);
      const adresse = await t.konten.discardPendingAddress(uid);
      await deleteDailyLimit(t, uid);
      return { uid, resolved: { haushalt: haushalt.hauptkonten, einladungen: haushalt.einladungen, adresse } };
    },
  );
  if (!r) return null;
  k.haushalt.reportHouseholdChange();
  await startpasswortDone(k, r.uid);
  hintInBackground(k, r.uid, 'passwort_zurueckgesetzt', undefined, { resolved: r.resolved });
  return r.uid;
}

/** Dieselbe Rechenzeit wie registriere(): Die Antwortzeit verriete sonst eine vergebene Adresse. */
export async function computeHowRegistration(passwort: string): Promise<void> {
  await hashe(passwort);
}

/** Länger als jeder Bestätigungslink gilt; danach sind Name und Adresse wieder frei. */
export const REGISTRATION_DEADLINE_DAYS = 7;
export function cleanOpenRegistrationsOn(k: AccountContext): Promise<number> {
  return accessTransaction(k, t => t.konten.deleteOpenRegistrations(REGISTRATION_DEADLINE_DAYS));
}

/** Konto und Protokolleintrag in einer Transaktion: Ein Konto ohne Eintrag
 * verschwiege, wer es angelegt hat. Gehasht wird vorher, damit bcrypt keine
 * Verbindung hält. @returns die neue ID, oder null, wenn der Name vergeben ist */
export async function putAccountAn(
  k: AccountContext,
  verwalter: number,
  username: string,
  passwort: string,
  asAdmin: boolean,
): Promise<number | null> {
  const hash = await hashe(passwort);
  return accessTransaction(k, async t => {
    // Auch gegen die Adressen: Die Anmeldung sucht in beiden Spalten.
    if (await t.konten.nameTaken(username, 0)) return null;
    const neu = await t.konten.addAccountOne(username, hash, asAdmin);
    if (neu === null) return null;
    await rememberAdminAction(t, verwalter, neu, 'konto_angelegt');
    if (asAdmin) await rememberAdminAction(t, verwalter, neu, 'verwalter_ernannt');
    return neu;
  }).catch(asDuplicate('benutzername_vergeben'));
}

export async function register(
  k: AccountContext,
  d: {
    username: string;
    email: string;
    first_name?: string | null | undefined;
    last_name?: string | null | undefined;
    passwort: string;
    tokenHash: string;
    bis: Date;
  },
): Promise<number | null> {
  return k.konten.registerAccount({
    username: d.username,
    email: d.email,
    first_name: d.first_name,
    last_name: d.last_name,
    hash: await hashe(d.passwort),
    tokenHash: d.tokenHash,
    bis: d.bis,
  });
}

/** Erst sperren, dann Zugänge löschen (die Token-Abfrage prüft is_active). Sitzungen
 * fallen über die Sitzungsversion, auch eine wieder geschriebene Zeile. */
export async function setzeAktiv(k: AccountContext, uid: number, soll: boolean): Promise<{ geaendert: boolean }> {
  const r = await accessTransaction(k, t => t.konten.writeActive(uid, soll));
  if (!r) notFound('benutzer_nicht_gefunden');
  if (r === repo.LAST_ADMIN) fachfehler('konflikt', 'letzter_verwalter');
  if (!soll) await endAccesses(k, uid);
  return { geaendert: r.vorher !== soll };
}

/** Ändert sich die Rolle, enden die Browser-Sitzungen: Sie tragen die Rolle
 * seit der Anmeldung. Der Token-Cache wird nur geleert — die App soll die neue
 * Rolle sehen, nicht abgemeldet werden. */
export async function setzeVerwalterRolle(
  k: AccountContext,
  uid: number,
  soll: boolean,
): Promise<{ geaendert: boolean }> {
  const vorher = await accessTransaction(k, t => t.konten.setAdmin(uid, soll));
  if (!vorher) notFound('benutzer_nicht_gefunden');
  if (vorher === repo.LAST_ADMIN) fachfehler('konflikt', 'letzter_verwalter');
  const geaendert = vorher.vorher !== soll;
  if (geaendert) {
    await endAllSessions(k, uid);
    emptyTokenCache(k);
  }
  return { geaendert };
}
