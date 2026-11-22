// Sending mail is a tool, not a route.

import type { MailContext } from './context';
import { basisUrl, hintWithoutBaseUrl } from '../infra/basisUrl';
import { esc, emailTemplate, emailBtn, infoBox, DIVIDER, mailTheme } from './template';
import { sendMail, testSmtp } from './transport';
import { fachfehler } from '../infra/errorTexts';
const setting = (k: MailContext, key: string) => k.einstellungen.globalValue(key, '');

// Re-exported so callers and tests keep a single address.
export { MAIL_THEMES, mailTheme, emailTemplate } from './template';
export {
  reportSmtpLegacySetting,
  linkForConsole,
  maskAddress,
  isSingleRecipient,
  sendMail,
  testSmtp,
} from './transport';

/** No name: the address is unconfirmed, and both name and username are chosen by whoever
 * registers — a greeting built from them would carry foreign text into a server mail.
 * If several registrations name the address, `multiple` points to the confirmation page. */
export async function sendVerificationMail(
  k: MailContext,
  to: string,
  token: string,
  baseUrl: string,
  lang = 'de',
  kind: 'registrierung' | 'adresse' = 'registrierung',
  multiple = false,
) {
  // Load at send time: the theme may have changed between two mails.
  const theme = await mailTheme(k);
  const url = `${baseUrl}/verify#token=${token}`;
  const isAddressChange = kind === 'adresse';
  const L =
    lang === 'en'
      ? {
          subject: 'BrickInventory Manager — Confirm your email',
          text: `Hello,\n\nplease confirm your email address:\n${url}\n\nThe link is valid for 24 hours.\n\nBrickInventory Manager`,
          title: 'Confirm email',
          preheader: 'Please confirm your email address.',
          greetHtml: `<p style="margin:0 0 8px">Hello,</p>
       <p style="margin:0 0 20px">${
         isAddressChange
           ? 'this address is to become the new email address of a BrickInventory Manager account. It only takes effect once you confirm it.'
           : 'welcome to BrickInventory Manager! Please confirm your email address to activate your account.'
       }</p>`,
          btn: '✓  Confirm email',
          multiple:
            'Several sign-ups name this address. Before confirming, the page shows the username this link belongs to: confirm only if it is yours.',
          note: `<p style="margin:0;font-size:13px;color:#6b7280">
         The link is valid for <strong>24 hours</strong>.<br>
         ${isAddressChange ? 'If you did not request this, ignore this email; nothing changes.' : 'If you did not sign up, you can safely ignore this email.'}
       </p>`,
        }
      : {
          subject: 'BrickInventory Manager — E-Mail bestätigen',
          text: `Hallo,\n\nbitte bestätige deine E-Mail-Adresse:\n${url}\n\nDer Link ist 24 Stunden gültig.\n\nBrickInventory Manager`,
          title: 'E-Mail bestätigen',
          preheader: 'Bitte bestätige deine E-Mail-Adresse.',
          greetHtml: `<p style="margin:0 0 8px">Hallo,</p>
       <p style="margin:0 0 20px">${
         isAddressChange
           ? 'diese Adresse soll die neue E-Mail-Adresse eines Kontos bei BrickInventory Manager werden. Sie gilt erst, wenn du sie bestätigst.'
           : 'willkommen bei BrickInventory Manager! Bitte bestätige deine E-Mail-Adresse um dein Konto zu aktivieren.'
       }</p>`,
          btn: '✓  E-Mail bestätigen',
          multiple:
            'Mehrere Registrierungen nennen diese Adresse. Vor dem Bestätigen zeigt die Seite den Benutzernamen, zu dem dieser Link gehört: Bestätige nur, wenn es deiner ist.',
          note: `<p style="margin:0;font-size:13px;color:#6b7280">
         Der Link ist <strong>24 Stunden</strong> gültig.<br>
         ${isAddressChange ? 'Hast du das nicht veranlasst, ignoriere diese E-Mail; es ändert sich nichts.' : 'Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren.'}
       </p>`,
        };
  const notice = multiple && !isAddressChange;
  return sendMail(k, {
    to,
    subject: L.subject,
    text: notice ? L.text.replace('\n\n', `\n\n${L.multiple}\n\n`) : L.text,
    link: url,
    html: emailTemplate(
      L.title,
      L.preheader,
      `${L.greetHtml}
       ${notice ? `<p style="margin:0 0 20px"><strong>${L.multiple}</strong></p>` : ''}
       ${emailBtn(url, L.btn, theme)}
       ${DIVIDER}
       ${L.note}`,
      theme,
    ),
  });
}

export async function sendEmailChangedMail(
  k: MailContext,
  to: string,
  username: string,
  newAddress: string,
  lang = 'de',
) {
  const theme = await mailTheme(k);
  const L =
    lang === 'en'
      ? {
          subject: 'BrickInventory Manager — New email address requested',
          title: 'Email address change requested',
          text: `Hello ${username},\n\na change of your account's email address to ${newAddress} was requested. It takes effect once it is confirmed there; until then this address stays.\n\nIf this was not you, sign in and change your password — or ask the administrator.\n\nBrickInventory Manager`,
          html: `<p style="margin:0 0 8px">Hello <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">a change of your account's email address to <strong>${esc(newAddress)}</strong> was requested. It takes effect once it is confirmed there; until then this address stays.</p>`,
          note: 'If this was not you, sign in and change your password — or ask the administrator.',
        }
      : {
          subject: 'BrickInventory Manager — Neue E-Mail-Adresse beantragt',
          title: 'Neue E-Mail-Adresse beantragt',
          text: `Hallo ${username},\n\nfür dein Konto wurde die E-Mail-Adresse ${newAddress} beantragt. Sie gilt erst, wenn sie dort bestätigt ist; bis dahin bleibt diese Adresse eingetragen.\n\nWarst du das nicht, melde dich an und ändere dein Passwort — oder wende dich an den Administrator.\n\nBrickInventory Manager`,
          html: `<p style="margin:0 0 8px">Hallo <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">für dein Konto wurde die E-Mail-Adresse <strong>${esc(newAddress)}</strong> beantragt. Sie gilt erst, wenn sie dort bestätigt ist; bis dahin bleibt diese Adresse eingetragen.</p>`,
          note: 'Warst du das nicht, melde dich an und ändere dein Passwort — oder wende dich an den Administrator.',
        };
  return sendMail(k, {
    to,
    subject: L.subject,
    text: L.text,
    html: emailTemplate(L.title, L.subject, `${L.html}${infoBox(L.note, theme)}`, theme),
  });
}

/** Registration answers a taken address like a new one; this is how its owner finds out. */
export async function sendRegistrationAttemptMail(
  k: MailContext,
  to: string,
  lang = 'de',
  reason: 'registrierung' | 'adresse' = 'registrierung',
) {
  const theme = await mailTheme(k);
  const L =
    reason === 'adresse'
      ? lang === 'en'
        ? {
            subject: 'BrickInventory Manager — Your email address in another account',
            title: 'Email address entered elsewhere',
            text: `Hello,\n\nsomeone tried to change the email address of another account to yours. Your account keeps it; nothing was changed.\n\nBrickInventory Manager`,
            html: `<p style="margin:0 0 8px">Hello,</p>
       <p style="margin:0 0 16px">someone tried to change the email address of another account to yours. Your account keeps it; nothing was changed.</p>`,
            note: 'You do not need to do anything.',
          }
        : {
            subject: 'BrickInventory Manager — Deine E-Mail-Adresse in einem anderen Konto',
            title: 'Adresse anderswo eingetragen',
            text: `Hallo,\n\njemand hat versucht, die E-Mail-Adresse eines anderen Kontos auf deine zu ändern. Dein Konto behält sie; geändert wurde nichts.\n\nBrickInventory Manager`,
            html: `<p style="margin:0 0 8px">Hallo,</p>
       <p style="margin:0 0 16px">jemand hat versucht, die E-Mail-Adresse eines anderen Kontos auf deine zu ändern. Dein Konto behält sie; geändert wurde nichts.</p>`,
            note: 'Du musst nichts tun.',
          }
      : lang === 'en'
        ? {
            subject: 'BrickInventory Manager — Registration with your email address',
            title: 'Registration attempt',
            text: `Hello,\n\nsomeone tried to register a new account with your email address. You already have an account; nothing was changed.\n\nIf you forgot your password, use “Forgot password” on the sign-in page.\n\nBrickInventory Manager`,
            html: `<p style="margin:0 0 8px">Hello,</p>
       <p style="margin:0 0 16px">someone tried to register a new account with your email address. You already have an account; nothing was changed.</p>`,
            note: 'If you forgot your password, use “Forgot password” on the sign-in page.',
          }
        : {
            subject: 'BrickInventory Manager — Registrierung mit deiner E-Mail-Adresse',
            title: 'Registrierungsversuch',
            text: `Hallo,\n\njemand hat versucht, mit deiner E-Mail-Adresse ein neues Konto anzulegen. Du hast schon eines; geändert wurde nichts.\n\nHast du dein Passwort vergessen, nutze „Passwort vergessen“ auf der Anmeldeseite.\n\nBrickInventory Manager`,
            html: `<p style="margin:0 0 8px">Hallo,</p>
       <p style="margin:0 0 16px">jemand hat versucht, mit deiner E-Mail-Adresse ein neues Konto anzulegen. Du hast schon eines; geändert wurde nichts.</p>`,
            note: 'Hast du dein Passwort vergessen, nutze „Passwort vergessen“ auf der Anmeldeseite.',
          };
  return sendMail(k, {
    to,
    subject: L.subject,
    text: L.text,
    html: emailTemplate(L.title, L.subject, `${L.html}${infoBox(L.note, theme)}`, theme),
  });
}

/** Registration answers a taken name like a success; only the given address learns
 * that it already exists. Without the name itself: whoever registers chooses it,
 * and the address is unconfirmed. */
export async function sendUsernameTakenMail(k: MailContext, to: string, lang = 'de', base = '') {
  const theme = await mailTheme(k);
  const L =
    lang === 'en'
      ? {
          subject: 'BrickInventory Manager — Username already taken',
          title: 'Username taken',
          text: `Hello,

someone tried to register an account with this email address under a username that already exists; no account was created.

If this was you, register again with a different username: ${base}

BrickInventory Manager`,
          html: `<p style="margin:0 0 16px">someone tried to register an account with this email address under a username that already exists; no account was created.</p>`,
          note: 'If this was you, register again with a different username.',
        }
      : {
          subject: 'BrickInventory Manager — Benutzername schon vergeben',
          title: 'Benutzername vergeben',
          text: `Hallo,

mit dieser E-Mail-Adresse wollte jemand ein Konto unter einem Benutzernamen anlegen, den es schon gibt; angelegt wurde nichts.

Warst du das, registriere dich mit einem anderen Benutzernamen: ${base}

BrickInventory Manager`,
          html: `<p style="margin:0 0 16px">mit dieser E-Mail-Adresse wollte jemand ein Konto unter einem Benutzernamen anlegen, den es schon gibt; angelegt wurde nichts.</p>`,
          note: 'Warst du das, registriere dich mit einem anderen Benutzernamen.',
        };
  return sendMail(k, {
    to,
    subject: L.subject,
    text: L.text,
    ...(base ? { link: base } : {}),
    html: emailTemplate(L.title, L.subject, `${L.html}${infoBox(L.note, theme)}`, theme),
  });
}

/** The main account reads the collection afterwards; someone who only captured a
 * session must not be able to set this up unnoticed. */
export async function sendHouseholdLinkedMail(
  k: MailContext,
  to: string,
  username: string,
  mainAccount: string,
  lang = 'de',
) {
  const theme = await mailTheme(k);
  const L =
    lang === 'en'
      ? {
          subject: 'BrickInventory Manager — Your account joined a household',
          title: 'Household linked',
          text: `Hello ${username},\n\nyour account is now a sub-account of ${mainAccount}. That account can see and change your collection.\n\nIf this was not you, sign in, change your password and leave the household under Menu → Household — or ask the administrator.\n\nBrickInventory Manager`,
          html: `<p style="margin:0 0 8px">Hello <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">your account is now a sub-account of <strong>${esc(mainAccount)}</strong>. That account can see and change your collection.</p>`,
          note: 'If this was not you, sign in, change your password and leave the household under Menu → Household — or ask the administrator.',
        }
      : {
          subject: 'BrickInventory Manager — Dein Konto ist einem Haushalt beigetreten',
          title: 'Haushalt verknüpft',
          text: `Hallo ${username},\n\ndein Konto ist jetzt Unterkonto von ${mainAccount}. Dieses Konto sieht und ändert deine Sammlung.\n\nWarst du das nicht, melde dich an, ändere dein Passwort und verlasse den Haushalt unter Menü → Haushalt — oder wende dich an den Administrator.\n\nBrickInventory Manager`,
          html: `<p style="margin:0 0 8px">Hallo <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">dein Konto ist jetzt Unterkonto von <strong>${esc(mainAccount)}</strong>. Dieses Konto sieht und ändert deine Sammlung.</p>`,
          note: 'Warst du das nicht, melde dich an, ändere dein Passwort und verlasse den Haushalt unter Menü → Haushalt — oder wende dich an den Administrator.',
        };
  return sendMail(k, {
    to,
    subject: L.subject,
    text: L.text,
    html: emailTemplate(L.title, L.subject, `${L.html}${infoBox(L.note, theme)}`, theme),
  });
}

/** Without a mail server there is no notice: the console does not reach the owner. */
export async function mailConfigured(k: MailContext): Promise<boolean> {
  return !!(await setting(k, 'smtp_host')) && !!(await setting(k, 'smtp_user'));
}

/** A link by mail only arrives with a mail server AND a public base URL; `incoming` holds values being saved right now. */
export async function mailReady(
  k: MailContext,
  incoming: { smtp_host?: unknown; smtp_user?: unknown } = {},
): Promise<boolean> {
  const value = async (n: 'smtp_host' | 'smtp_user') =>
    incoming[n] !== undefined ? String(incoming[n] ?? '') : await setting(k, n);
  return !!basisUrl() && !!(await value('smtp_host')) && !!(await value('smtp_user'));
}

export type AccountNotice =
  | 'passkey_neu'
  | 'passwort_geaendert'
  | 'passwort_zurueckgesetzt'
  | 'token_neu'
  | 'qr_zugang_neu'
  | 'zweiter_faktor_entfernt'
  | 'verwalter_ernannt'
  | 'verwaltung_faktor_entfernt'
  | 'token_wiederverwendet'
  | 'passwort_durch_verwalter'
  | 'verwaltung_passwort_gesetzt'
  | 'zweiter_faktor_eingerichtet'
  | 'zweiter_faktor_abgeschaltet'
  | 'anmeldung_gebremst'
  | 'anmeldung_tagesgrenze'
  | 'zweiter_faktor_gesperrt'
  | 'bestaetigung_gebremst'
  | 'einstellungen_geaendert'
  | 'zugang_beendet'
  | 'zugaenge_beendet'
  | 'uebernahme_angekuendigt'
  | 'verwaltung_uebernahme_angekuendigt'
  | 'verwaltung_uebernahme_abgebrochen'
  | 'alte_codes_ablauf'
  | 'verwalter_aktion_ausgefuehrt'
  | 'verwaltung_aktion_ausgefuehrt'
  | 'anmeldung_freigeben';

/** No secrets; a link only for cancelling or releasing, sent to the account itself. `haushalt` names the accounts that see
 * this collection: an intruder could have added themselves there. */
/** What "forgot password" ended besides the password. */
export type ResetSideEffects = { haushalt: string[]; einladungen: number; adresse: string | null };

/** The one sentence about what happened to the account. */
type NoticeDetails = {
  resolved?: ResetSideEffects | undefined;
  passkey?: string;
  konto?: string | undefined;
  durch?: string | undefined;
  was?: string | undefined;
  bis?: string | undefined;
  /** Plain text of a link (cancelling an announcement, releasing a sign-in); only to the target. */
  abbruch?: string | undefined;
  freigabe?: string | undefined;
  adresse?: string | undefined;
};

/** What an administrator wants to change on another account, and from when (UTC, without the server's locale). */
function takeover(o: NoticeDetails, en: boolean): { was: string; bis: string } {
  const kinds = (o.was ?? '').split(', ');
  const sentence: Record<string, [string, string]> = {
    passwort: ['ein neues Passwort setzen', 'set a new password'],
    zweiter_faktor: ['den zweiten Faktor entfernen', 'remove the second factor'],
    deaktivieren: ['das Konto deaktivieren', 'deactivate the account'],
    rolle_entziehen: ['die Administratorrechte entziehen', 'revoke the administrator rights'],
    loeschen: ['das Konto löschen', 'delete the account'],
  };
  const was = kinds.map(a => (sentence[a] ?? ['', ''])[en ? 1 : 0]).join(en ? ' and ' : ' und ');
  return { was, bis: o.bis ? `${o.bis.slice(0, 16).replace('T', ' ')} UTC` : '' };
}

/** The owner should see what an intruder might have created and what was removed. */
function sideEffectsSentence(g: ResetSideEffects | undefined, en: boolean): string {
  if (!g) return '';
  const parts: string[] = [];
  if (g.haushalt.length)
    parts.push(
      en
        ? `the link to ${g.haushalt.map(n => `“${n}”`).join(', ')} (these accounts could see your collection)`
        : `die Verknüpfung mit ${g.haushalt.map(n => `„${n}“`).join(', ')} (diese Konten sahen deine Sammlung)`,
    );
  if (g.adresse)
    parts.push(
      en
        ? `the pending change of your email address to ${g.adresse}`
        : `die ausstehende Änderung deiner E-Mail-Adresse auf ${g.adresse}`,
    );
  if (g.einladungen)
    parts.push(en ? `${g.einladungen} open household invitation(s)` : `${g.einladungen} offene Haushaltseinladung(en)`);
  if (!parts.length) return '';
  return en ? ` Also removed: ${parts.join('; ')}.` : ` Ausserdem aufgehoben: ${parts.join('; ')}.`;
}

function takeoverSentences(o: NoticeDetails, en: boolean) {
  const u = takeover(o, en);
  return {
    uebernahme_angekuendigt: en
      ? `the administrator “${o.durch ?? ''}” wants to ${u.was} for your account. This takes effect on ${u.bis}. If you do not want this, sign in before then (signing out and in again is enough) or open the link below; the change is then dropped. If you asked for it yourself, you need not do anything.`
      : `der Administrator „${o.durch ?? ''}“ will für dein Konto ${u.was}. Das gilt ab ${u.bis}. Willst du das nicht, melde dich vorher an (ab- und wieder anmelden genügt) oder öffne den Link unten; dann entfällt die Änderung. Hast du selbst darum gebeten, musst du nichts tun.`,
    verwaltung_uebernahme_angekuendigt: en
      ? `“${o.durch ?? ''}” wants to ${u.was} for the account “${o.konto ?? ''}”, effective ${u.bis} unless “${o.konto ?? ''}” signs in before then.`
      : `„${o.durch ?? ''}“ will für das Konto „${o.konto ?? ''}“ ${u.was}, wirksam ab ${u.bis}, wenn sich „${o.konto ?? ''}“ bis dahin nicht anmeldet.`,
    verwaltung_uebernahme_abgebrochen: en
      ? `“${o.konto ?? ''}” signed in or cancelled by the link in the email; the announced change (${u.was}) is dropped.`
      : `„${o.konto ?? ''}“ hat sich angemeldet oder über den Link in der Mail abgebrochen; die angekündigte Änderung (${u.was}) entfällt.`,
    verwalter_aktion_ausgefuehrt: en
      ? `the announced change by the administrator “${o.durch ?? ''}” took effect: ${u.was}.`
      : `die angekündigte Änderung des Administrators „${o.durch ?? ''}“ ist wirksam: ${u.was}.`,
    verwaltung_aktion_ausgefuehrt: en
      ? `the change to the administrator account “${o.konto ?? ''}” announced by “${o.durch ?? ''}” took effect: ${u.was}.`
      : `die von „${o.durch ?? ''}“ angekündigte Änderung am Administratorkonto „${o.konto ?? ''}“ ist wirksam: ${u.was}.`,
    anmeldung_freigeben: en
      ? `your account reached the limit of failed sign-in attempts. Signing in with the password from a new place (address ${o.adresse ?? '?'}) is blocked for now. If that was you, open the link below: it allows signing in from that address again. If not, ignore this email.`
      : `für dein Konto ist die Grenze der Fehlversuche erreicht. Mit dem Passwort ist die Anmeldung von einem neuen Ort (Adresse ${o.adresse ?? '?'}) vorerst gesperrt. Warst du das, öffne den Link unten: Er schaltet die Anmeldung von dieser Adresse wieder frei. Sonst ignoriere diese Mail.`,
    alte_codes_ablauf: en
      ? `you signed in with a recovery code from before 1 November 2026. Codes of that kind are only accepted until ${u.bis}. Create new recovery codes under Menu → Account → Two-factor authentication.`
      : `du hast dich mit einem Wiederherstellungscode von vor dem 01.11.2026 angemeldet. Codes dieser Art gelten nur noch bis ${u.bis}. Erzeuge unter Menü → Konto → Zweiter Faktor neue Wiederherstellungscodes.`,
  };
}

function noticeSentence(kind: AccountNotice, o: NoticeDetails, en: boolean): string {
  const sentences: Record<AccountNotice, string> = {
    ...takeoverSentences(o, en),
    passkey_neu: en
      ? `a new passkey (“${o.passkey ?? ''}”) was added to your account.`
      : `deinem Konto wurde ein neuer Passkey („${o.passkey ?? ''}“) hinzugefügt.`,
    passwort_geaendert: en ? 'the password of your account was changed.' : 'das Passwort deines Kontos wurde geändert.',
    passwort_zurueckgesetzt:
      (en
        ? 'the password of your account was reset by email. All sign-ins, app tokens and passkeys were ended.'
        : 'das Passwort deines Kontos wurde per E-Mail zurückgesetzt. Alle Anmeldungen, App-Zugänge und Passkeys wurden beendet.') +
      sideEffectsSentence(o.resolved, en),
    token_neu: en
      ? `a new app token (“${o.passkey ?? ''}”) was created for your account.`
      : `für dein Konto wurde ein neuer App-Zugang („${o.passkey ?? ''}“) erzeugt.`,
    qr_zugang_neu: en
      ? 'a QR code to sign in the app was created for your account.'
      : 'für dein Konto wurde ein QR-Code zur Anmeldung der App erzeugt.',
    zweiter_faktor_entfernt: en
      ? `the administrator “${o.durch ?? ''}” removed the second factor of your account.`
      : `der Administrator „${o.durch ?? ''}“ hat den zweiten Faktor deines Kontos entfernt.`,
    verwalter_ernannt: en
      ? `“${o.durch ?? ''}” made the account “${o.konto ?? ''}” an administrator.`
      : `„${o.durch ?? ''}“ hat das Konto „${o.konto ?? ''}“ zum Administrator gemacht.`,
    verwaltung_faktor_entfernt: en
      ? `“${o.durch ?? ''}” removed the second factor of the account “${o.konto ?? ''}”.`
      : `„${o.durch ?? ''}“ hat den zweiten Faktor des Kontos „${o.konto ?? ''}“ entfernt.`,
    passwort_durch_verwalter: en
      ? `the administrator “${o.durch ?? ''}” set a new password for your account. All sign-ins and app tokens were ended.`
      : `der Administrator „${o.durch ?? ''}“ hat ein neues Passwort für dein Konto gesetzt. Alle Anmeldungen und App-Zugänge wurden beendet.`,
    verwaltung_passwort_gesetzt: en
      ? `“${o.durch ?? ''}” set a new password for the account “${o.konto ?? ''}”.`
      : `„${o.durch ?? ''}“ hat ein neues Passwort für das Konto „${o.konto ?? ''}“ gesetzt.`,
    zweiter_faktor_eingerichtet: en
      ? 'a second factor (authenticator app) was set up for your account. All other sign-ins and app tokens were ended.'
      : 'für dein Konto wurde ein zweiter Faktor (Authenticator-App) eingerichtet. Alle anderen Anmeldungen und App-Zugänge wurden beendet.',
    zweiter_faktor_abgeschaltet: en
      ? 'the second factor of your account was turned off.'
      : 'der zweite Faktor deines Kontos wurde abgeschaltet.',
    anmeldung_gebremst: en
      ? 'there were several failed sign-in attempts for your account; further attempts are slowed down for now.'
      : 'für dein Konto gab es mehrere fehlgeschlagene Anmeldeversuche; weitere Versuche werden vorerst gebremst.',
    anmeldung_tagesgrenze: en
      ? 'there were 50 failed sign-in attempts for your account within 24 hours. For now, signing in with the password only works together with the second factor; a passkey or “Forgot password” work as before. Change your password if it may be known.'
      : 'für dein Konto gab es 50 fehlgeschlagene Anmeldeversuche in 24 Stunden. Mit dem Passwort geht die Anmeldung vorerst nur zusammen mit dem zweiten Faktor; Passkey und „Passwort vergessen“ gehen wie bisher. Ändere dein Passwort, falls es bekannt sein könnte.',
    zweiter_faktor_gesperrt: en
      ? 'someone entered the right password for your account but many wrong codes of the second factor. For up to 24 hours, sign-in only works with a recovery code or a passkey. Change your password: it is probably known.'
      : 'für dein Konto wurde das richtige Passwort, aber vielfach ein falscher Code des zweiten Faktors eingegeben. Bis zu 24 Stunden geht die Anmeldung nur mit einem Wiederherstellungscode oder Passkey. Ändere dein Passwort: Es ist vermutlich bekannt.',
    bestaetigung_gebremst: en
      ? 'in a signed-in session or app of your account, the password or code was entered wrongly several times when confirming; further attempts are slowed down for now.'
      : 'in einer angemeldeten Sitzung oder App deines Kontos wurde beim Bestätigen mehrmals ein falsches Passwort oder ein falscher Code eingegeben; weitere Versuche werden vorerst gebremst.',
    einstellungen_geaendert: en
      ? `“${o.durch ?? ''}” changed security-relevant settings: ${o.konto ?? ''}.`
      : `„${o.durch ?? ''}“ hat sicherheitsrelevante Einstellungen geändert: ${o.konto ?? ''}.`,
    zugang_beendet: en
      ? `the app token “${o.passkey ?? ''}” of your account was signed out from another device.`
      : `der App-Zugang „${o.passkey ?? ''}“ deines Kontos wurde von einem anderen Gerät aus abgemeldet.`,
    zugaenge_beendet: en
      ? 'all other sign-ins and app tokens of your account were ended.'
      : 'alle anderen Anmeldungen und App-Zugänge deines Kontos wurden beendet.',
    token_wiederverwendet: en
      ? `an already replaced app token (“${o.passkey ?? ''}”) was used again, so someone has a copy. All tokens of that device were ended; sign in to the app again.`
      : `ein schon ersetzter App-Zugang („${o.passkey ?? ''}“) wurde erneut benutzt, jemand hat also eine Kopie. Alle Zugänge dieses Geräts sind beendet; melde die App neu an.`,
  };
  return sentences[kind];
}

export async function sendAccountNoticeMail(
  k: MailContext,
  to: string,
  username: string,
  kind: AccountNotice,
  o: NoticeDetails & { lang?: string; haushalt?: string[] } = {},
) {
  const theme = await mailTheme(k);
  const en = o.lang === 'en';
  const was = noticeSentence(kind, o, en);
  const subject = en
    ? 'BrickInventory Manager — Change to your account'
    : 'BrickInventory Manager — Änderung an deinem Konto';
  const household = o.haushalt?.length
    ? en
      ? `These accounts can see and change your collection: ${o.haushalt.join(', ')}.`
      : `Diese Konten sehen und ändern deine Sammlung: ${o.haushalt.join(', ')}.`
    : '';
  const note = en
    ? 'If this was not you, reset your password via “Forgot password”, check Menu → Account and Menu → Household — or ask the administrator.'
    : 'Warst du das nicht, setze dein Passwort über „Passwort vergessen“ zurück und prüfe Menü → Konto und Menü → Haushalt — oder wende dich an den Administrator.';
  const hello = en ? 'Hello' : 'Hallo';
  const base = basisUrl();
  const link =
    base && o.abbruch
      ? {
          url: `${base}/uebernahme-abbrechen#token=${o.abbruch}`,
          button: en ? 'Cancel the change' : 'Änderung abbrechen',
        }
      : base && o.freigabe
        ? {
            url: `${base}/anmeldung-freigeben#token=${o.freigabe}`,
            button: en ? 'Allow this sign-in' : 'Anmeldung freigeben',
          }
        : null;
  const text = `${hello} ${username},\n\n${was}\n${link ? `\n${link.url}\n` : ''}${household ? `\n${household}\n` : ''}\n${note}\n\nBrickInventory Manager`;
  const html = `<p style="margin:0 0 8px">${hello} <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">${esc(was)}</p>${link ? emailBtn(link.url, link.button, theme) : ''}${household ? `<p style="margin:0 0 16px">${esc(household)}</p>` : ''}`;
  return sendMail(k, {
    to,
    subject,
    text,
    ...(link ? { link: link.url } : {}),
    html: emailTemplate(en ? 'Account changed' : 'Konto geändert', subject, `${html}${infoBox(note, theme)}`, theme),
  });
}

// In the account's language, like all mails.
export async function sendPasswordResetMail(k: MailContext, to: string, token: string, baseUrl: string, lang = 'de') {
  const theme = await mailTheme(k);
  const url = `${baseUrl}/reset-password#token=${token}`;
  const de = lang !== 'en';
  const L = de
    ? {
        subject: 'BrickInventory Manager — Passwort zurücksetzen',
        text: `Hallo,\n\nPasswort zurücksetzen:\n${url}\n\nGültig 1 Stunde.\n\nBrickInventory Manager`,
        title: 'Passwort zurücksetzen',
        preheader: 'Setze dein Passwort für BrickInventory Manager zurück.',
        greetHtml: `<p style="margin:0 0 8px">Hallo,</p>
       <p style="margin:0 0 20px">du hast eine Passwort-Rücksetzung angefordert. Klicke auf den Button um ein neues Passwort zu setzen.</p>`,
        btn: '🔑  Passwort zurücksetzen',
        box: 'Der Link ist <strong>1 Stunde</strong> gültig und kann nur einmal verwendet werden.',
        note: `Falls du keine Rücksetzung angefordert hast, kannst du diese E-Mail ignorieren.<br>
           Dein Passwort bleibt unverändert.`,
      }
    : {
        subject: 'BrickInventory Manager — Reset your password',
        text: `Hello,\n\nReset your password:\n${url}\n\nValid for 1 hour.\n\nBrickInventory Manager`,
        title: 'Reset password',
        preheader: 'Reset your BrickInventory Manager password.',
        greetHtml: `<p style="margin:0 0 8px">Hello,</p>
       <p style="margin:0 0 20px">you asked to reset your password. Click the button to choose a new one.</p>`,
        btn: '🔑  Reset password',
        box: 'The link is valid for <strong>1 hour</strong> and can only be used once.',
        note: `If you did not ask for a reset, you can safely ignore this email.<br>
           Your password stays unchanged.`,
      };
  return sendMail(k, {
    to,
    subject: L.subject,
    text: L.text,
    link: url,
    html: emailTemplate(
      L.title,
      L.preheader,
      `${L.greetHtml}
       ${emailBtn(url, L.btn, theme)}
       ${infoBox(L.box, theme)}
       ${DIVIDER}
       <p style="margin:0;font-size:13px;color:#6b7280">${L.note}</p>`,
      theme,
    ),
  });
}

// Through emailTemplate() like the other mails, so it carries the theme.
export interface AlertMailData {
  username: string;
  /** The RECIPIENT's language, not the server's. */
  lang: string;
  setNumber: string;
  /** If missing, the mail shows the number. */
  setName?: string | null;
  condition: string;
  direction: 'unter' | 'ueber';
  threshold: number;
  price: number;
  currency: string;
}

/** Market price and threshold side by side in large type — the only question of this mail.
 * A table instead of flex because of Outlook. */
function alertNumbers(theme: Awaited<ReturnType<typeof mailTheme>>, de: boolean, price: string, threshold: string) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 20px;table-layout:fixed">
    <tr>
      <td width="44%" style="width:44%;background:${theme.bg};border:1px solid ${theme.border};border-radius:8px;
                 padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px">${de ? 'Marktpreis' : 'Market price'}</div>
        <div style="font-size:22px;font-weight:700;color:${theme.primary}">${esc(price)}</div>
      </td>
      <td width="12%" style="width:12%;font-size:0;line-height:0">&nbsp;</td>
      <td width="44%" style="width:44%;background:${theme.bg};border:1px solid ${theme.border};border-radius:8px;
                 padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px">${de ? 'Deine Schwelle' : 'Your threshold'}</div>
        <div style="font-size:22px;font-weight:700;color:${theme.text}">${esc(threshold)}</div>
      </td>
    </tr>
  </table>`;
}

// Without APP_BASE_URL the mail says why the button is missing.
export async function buildAlertMail(
  k: MailContext,
  d: AlertMailData,
): Promise<{ subject: string; text: string; html: string; link?: string }> {
  const theme = await mailTheme(k);
  const de = d.lang !== 'en';
  const money = (n: number) => `${d.currency} ${n.toFixed(2)}`;
  const condition = d.condition === 'U' ? (de ? 'gebraucht' : 'used') : de ? 'neu' : 'new';
  const direction = d.direction === 'unter' ? (de ? 'unter' : 'below') : de ? 'über' : 'above';
  const title = d.setName || d.setNumber;

  // The link is OPTIONAL: the price run has no request; without APP_BASE_URL
  // the mail goes out without a button instead of pointing at a guessed host.
  const base = basisUrl();
  if (!base)
    hintWithoutBaseUrl(
      'mailer',
      'die Preisalarm-Mail geht OHNE den Knopf „Set ansehen" hinaus. Der Preislauf hat keine Anfrage, aus der sich der Host ableiten liesse; ohne die Variable gaebe es nur einen geratenen Link.',
    );
  const url = base ? `${base}/?set=${encodeURIComponent(d.setNumber)}` : '';

  const subject = de
    ? `Preisalarm: ${d.setNumber} liegt ${direction} ${money(d.threshold)}`
    : `Price alert: ${d.setNumber} is ${direction} ${money(d.threshold)}`;

  // The plain text goes along as text/plain; some clients show only that.
  const text = de
    ? `Hallo ${d.username},\n\n` +
      `der Marktpreis für ${d.setNumber} (${condition}) liegt bei ${money(d.price)} ` +
      `und damit ${direction} deiner Schwelle von ${money(d.threshold)}.\n\n` +
      `Diese Meldung kommt einmal je Übergang: Erst wenn der Preis wieder auf ` +
      `die andere Seite wechselt, kann sie erneut ausgelöst werden.\n`
    : `Hi ${d.username},\n\n` +
      `the market price for ${d.setNumber} (${condition}) is ${money(d.price)}, ` +
      `which is ${direction} your threshold of ${money(d.threshold)}.\n\n` +
      `You get this once per crossing: it can only trigger again after the ` +
      `price has moved back to the other side.\n`;

  const numbers = alertNumbers(theme, de, money(d.price), money(d.threshold));

  const intro = de
    ? `<p style="margin:0 0 8px">Hallo <strong>${esc(d.username)}</strong>,</p>
       <p style="margin:0 0 20px">der Marktpreis für <strong>${esc(title)}</strong>
          (${esc(d.setNumber)}, ${esc(condition)}) liegt <strong>${esc(direction)}</strong> deiner Schwelle.</p>`
    : `<p style="margin:0 0 8px">Hi <strong>${esc(d.username)}</strong>,</p>
       <p style="margin:0 0 20px">the market price for <strong>${esc(title)}</strong>
          (${esc(d.setNumber)}, ${esc(condition)}) is <strong>${esc(direction)}</strong> your threshold.</p>`;

  const notice = de
    ? 'Diese Meldung kommt <strong>einmal je Übergang</strong>. Erst wenn der Preis wieder auf die andere Seite wechselt, kann sie erneut ausgelöst werden.'
    : 'You get this <strong>once per crossing</strong>. It can only trigger again after the price has moved back to the other side.';

  return {
    subject,
    text,
    ...(url ? { link: url } : {}),
    html: emailTemplate(
      de ? 'Preisalarm' : 'Price alert',
      de
        ? `${d.setNumber} liegt ${direction} ${money(d.threshold)}.`
        : `${d.setNumber} is ${direction} ${money(d.threshold)}.`,
      `${intro}
       ${numbers}
       ${url ? emailBtn(url, de ? '🔔  Set ansehen' : '🔔  View set', theme) : ''}
       ${infoBox(notice, theme)}
       ${DIVIDER}
       <p style="margin:0;font-size:13px;color:#6b7280">
         ${
           de
             ? 'Du bekommst diese Mail, weil du für dieses Set einen Preisalarm gesetzt hast.'
             : 'You receive this email because you set a price alert for this set.'
         }
       </p>`,
      theme,
    ),
  };
}

/** First the connection, then a probe to `to`; subject and text belong to sending, not to the route. */
/** A rejection while checking the server throws; sending itself reports how it went. */
export async function sendSmtpTest(k: MailContext, to: string) {
  const verify = await testSmtp(k);
  if ('code' in verify) fachfehler('ungueltig', verify.code, 'vars' in verify ? verify.vars : undefined);
  return sendMail(k, {
    to,
    subject: 'BrickInventory Manager — SMTP Test',
    text: 'Diese E-Mail bestätigt, dass deine SMTP-Konfiguration korrekt funktioniert.',
    html: '<div style="font-family:Arial,sans-serif;padding:20px"><h2>✅ SMTP-Test erfolgreich</h2><p>Deine SMTP-Konfiguration funktioniert korrekt.</p></div>',
  });
}
