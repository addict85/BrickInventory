// Ausführlich: docs/begruendungen/src/mail/mailer.ts.md#abschnitt

import { getGlobalSetting } from '../einstellungen/settings';
import { basisUrl, hinweisOhneBasisUrl } from '../infra/basisUrl';
import { esc, emailTemplate, emailBtn, infoBox, DIVIDER, getMailTheme } from './vorlage';
import { sendMail } from './transport';
const getSetting = (key: string) => getGlobalSetting(key, '');

// Mitexportiert, damit Aufrufer und Tests bei einer Adresse bleiben.
export { MAIL_THEMES, getMailTheme, emailTemplate } from './vorlage';
export { meldeSmtpAltlast, linkFuerKonsole, maskiereAdresse, einzigerEmpfaenger, sendMail, testSmtp } from './transport';

/** Ohne Namen: Die Adresse ist unbestätigt, und Name wie Benutzername wählt,
 * wer registriert — eine Anrede daraus trüge fremden Text in eine Mail des Servers.
 * Nennen mehrere Registrierungen die Adresse, verweist `mehrere` auf die Bestätigungsseite. */
export async function sendVerificationMail(to: string, token: string, baseUrl: string, lang = 'de',
                                           art: 'registrierung' | 'adresse' = 'registrierung', mehrere = false) {
  // Beim Versand laden: Das Design kann sich zwischen zwei Mails geändert haben.
  const theme = await getMailTheme();
  const url = `${baseUrl}/verify?token=${token}`;
  const adresse = art === 'adresse';
  const L = lang === 'en' ? {
    subject: 'BrickInventory Manager — Confirm your email',
    text: `Hello,\n\nplease confirm your email address:\n${url}\n\nThe link is valid for 24 hours.\n\nBrickInventory Manager`,
    title: 'Confirm email',
    preheader: 'Please confirm your email address.',
    greetHtml: `<p style="margin:0 0 8px">Hello,</p>
       <p style="margin:0 0 20px">${adresse
         ? 'this address is to become the new email address of a BrickInventory Manager account. It only takes effect once you confirm it.'
         : 'welcome to BrickInventory Manager! Please confirm your email address to activate your account.'}</p>`,
    btn: '✓  Confirm email',
    mehrere: 'Several sign-ups name this address. Before confirming, the page shows the username this link belongs to: confirm only if it is yours.',
    note: `<p style="margin:0;font-size:13px;color:#6b7280">
         The link is valid for <strong>24 hours</strong>.<br>
         ${adresse ? 'If you did not request this, ignore this email; nothing changes.' : 'If you did not sign up, you can safely ignore this email.'}
       </p>`,
  } : {
    subject: 'BrickInventory Manager — E-Mail bestätigen',
    text: `Hallo,\n\nbitte bestätige deine E-Mail-Adresse:\n${url}\n\nDer Link ist 24 Stunden gültig.\n\nBrickInventory Manager`,
    title: 'E-Mail bestätigen',
    preheader: 'Bitte bestätige deine E-Mail-Adresse.',
    greetHtml: `<p style="margin:0 0 8px">Hallo,</p>
       <p style="margin:0 0 20px">${adresse
         ? 'diese Adresse soll die neue E-Mail-Adresse eines Kontos bei BrickInventory Manager werden. Sie gilt erst, wenn du sie bestätigst.'
         : 'willkommen bei BrickInventory Manager! Bitte bestätige deine E-Mail-Adresse um dein Konto zu aktivieren.'}</p>`,
    btn: '✓  E-Mail bestätigen',
    mehrere: 'Mehrere Registrierungen nennen diese Adresse. Vor dem Bestätigen zeigt die Seite den Benutzernamen, zu dem dieser Link gehört: Bestätige nur, wenn es deiner ist.',
    note: `<p style="margin:0;font-size:13px;color:#6b7280">
         Der Link ist <strong>24 Stunden</strong> gültig.<br>
         ${adresse ? 'Hast du das nicht veranlasst, ignoriere diese E-Mail; es ändert sich nichts.' : 'Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren.'}
       </p>`,
  };
  const hinweis = mehrere && !adresse;
  return sendMail({
    to,
    subject: L.subject,
    text: hinweis ? L.text.replace('\n\n', `\n\n${L.mehrere}\n\n`) : L.text,
    link: url,
    html: emailTemplate(
      L.title,
      L.preheader,
      `${L.greetHtml}
       ${hinweis ? `<p style="margin:0 0 20px"><strong>${L.mehrere}</strong></p>` : ''}
       ${emailBtn(url, L.btn, theme)}
       ${DIVIDER}
       ${L.note}`,
      theme
    ),
  });
}

export async function sendEmailGeaendertMail(to: string, username: string, neueAdresse: string, lang = 'de') {
  const theme = await getMailTheme();
  const L = lang === 'en' ? {
    subject: 'BrickInventory Manager — New email address requested',
    title: 'Email address change requested',
    text: `Hello ${username},\n\na change of your account's email address to ${neueAdresse} was requested. It takes effect once it is confirmed there; until then this address stays.\n\nIf this was not you, sign in and change your password — or ask the administrator.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hello <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">a change of your account's email address to <strong>${esc(neueAdresse)}</strong> was requested. It takes effect once it is confirmed there; until then this address stays.</p>`,
    note: 'If this was not you, sign in and change your password — or ask the administrator.',
  } : {
    subject: 'BrickInventory Manager — Neue E-Mail-Adresse beantragt',
    title: 'Neue E-Mail-Adresse beantragt',
    text: `Hallo ${username},\n\nfür dein Konto wurde die E-Mail-Adresse ${neueAdresse} beantragt. Sie gilt erst, wenn sie dort bestätigt ist; bis dahin bleibt diese Adresse eingetragen.\n\nWarst du das nicht, melde dich an und ändere dein Passwort — oder wende dich an den Verwalter.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hallo <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">für dein Konto wurde die E-Mail-Adresse <strong>${esc(neueAdresse)}</strong> beantragt. Sie gilt erst, wenn sie dort bestätigt ist; bis dahin bleibt diese Adresse eingetragen.</p>`,
    note: 'Warst du das nicht, melde dich an und ändere dein Passwort — oder wende dich an den Verwalter.',
  };
  return sendMail({ to, subject: L.subject, text: L.text,
    html: emailTemplate(L.title, L.subject, `${L.html}${infoBox(L.note, theme)}`, theme) });
}

/** Die Registrierung antwortet auf eine vergebene Adresse wie auf eine neue; das hier erfährt ihr Inhaber. */
export async function sendRegistrierungsVersuchMail(to: string, lang = 'de', anlass: 'registrierung' | 'adresse' = 'registrierung') {
  const theme = await getMailTheme();
  const L = anlass === 'adresse' ? (lang === 'en' ? {
    subject: 'BrickInventory Manager — Your email address in another account',
    title: 'Email address entered elsewhere',
    text: `Hello,\n\nsomeone tried to change the email address of another account to yours. Your account keeps it; nothing was changed.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hello,</p>
       <p style="margin:0 0 16px">someone tried to change the email address of another account to yours. Your account keeps it; nothing was changed.</p>`,
    note: 'You do not need to do anything.',
  } : {
    subject: 'BrickInventory Manager — Deine E-Mail-Adresse in einem anderen Konto',
    title: 'Adresse anderswo eingetragen',
    text: `Hallo,\n\njemand hat versucht, die E-Mail-Adresse eines anderen Kontos auf deine zu ändern. Dein Konto behält sie; geändert wurde nichts.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hallo,</p>
       <p style="margin:0 0 16px">jemand hat versucht, die E-Mail-Adresse eines anderen Kontos auf deine zu ändern. Dein Konto behält sie; geändert wurde nichts.</p>`,
    note: 'Du musst nichts tun.',
  }) : lang === 'en' ? {
    subject: 'BrickInventory Manager — Registration with your email address',
    title: 'Registration attempt',
    text: `Hello,\n\nsomeone tried to register a new account with your email address. You already have an account; nothing was changed.\n\nIf you forgot your password, use “Forgot password” on the sign-in page.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hello,</p>
       <p style="margin:0 0 16px">someone tried to register a new account with your email address. You already have an account; nothing was changed.</p>`,
    note: 'If you forgot your password, use “Forgot password” on the sign-in page.',
  } : {
    subject: 'BrickInventory Manager — Registrierung mit deiner E-Mail-Adresse',
    title: 'Registrierungsversuch',
    text: `Hallo,\n\njemand hat versucht, mit deiner E-Mail-Adresse ein neues Konto anzulegen. Du hast schon eines; geändert wurde nichts.\n\nHast du dein Passwort vergessen, nutze „Passwort vergessen“ auf der Anmeldeseite.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hallo,</p>
       <p style="margin:0 0 16px">jemand hat versucht, mit deiner E-Mail-Adresse ein neues Konto anzulegen. Du hast schon eines; geändert wurde nichts.</p>`,
    note: 'Hast du dein Passwort vergessen, nutze „Passwort vergessen“ auf der Anmeldeseite.',
  };
  return sendMail({ to, subject: L.subject, text: L.text,
    html: emailTemplate(L.title, L.subject, `${L.html}${infoBox(L.note, theme)}`, theme) });
}

/** Die Registrierung antwortet bei vergebenem Namen wie bei Erfolg; nur die
 * angegebene Adresse erfährt, dass es ihn schon gibt. Ohne den Namen selbst:
 * Ihn wählt, wer registriert, und die Adresse ist unbestätigt. */
export async function sendBenutzernameVergebenMail(to: string, lang = 'de', basis = '') {
  const theme = await getMailTheme();
  const L = lang === 'en' ? {
    subject: 'BrickInventory Manager — Username already taken',
    title: 'Username taken',
    text: `Hello,

someone tried to register an account with this email address under a username that already exists; no account was created.

If this was you, register again with a different username: ${basis}

BrickInventory Manager`,
    html: `<p style="margin:0 0 16px">someone tried to register an account with this email address under a username that already exists; no account was created.</p>`,
    note: 'If this was you, register again with a different username.',
  } : {
    subject: 'BrickInventory Manager — Benutzername schon vergeben',
    title: 'Benutzername vergeben',
    text: `Hallo,

mit dieser E-Mail-Adresse wollte jemand ein Konto unter einem Benutzernamen anlegen, den es schon gibt; angelegt wurde nichts.

Warst du das, registriere dich mit einem anderen Benutzernamen: ${basis}

BrickInventory Manager`,
    html: `<p style="margin:0 0 16px">mit dieser E-Mail-Adresse wollte jemand ein Konto unter einem Benutzernamen anlegen, den es schon gibt; angelegt wurde nichts.</p>`,
    note: 'Warst du das, registriere dich mit einem anderen Benutzernamen.',
  };
  return sendMail({ to, subject: L.subject, text: L.text, ...(basis ? { link: basis } : {}),
    html: emailTemplate(L.title, L.subject, `${L.html}${infoBox(L.note, theme)}`, theme) });
}

/** Das Hauptkonto liest danach den Bestand mit; wer nur eine Sitzung erbeutet
 * hat, soll das nicht unbemerkt einrichten können. */
export async function sendHaushaltVerknuepftMail(to: string, username: string, hauptkonto: string, lang = 'de') {
  const theme = await getMailTheme();
  const L = lang === 'en' ? {
    subject: 'BrickInventory Manager — Your account joined a household',
    title: 'Household linked',
    text: `Hello ${username},\n\nyour account is now a sub-account of ${hauptkonto}. That account can see and change your collection.\n\nIf this was not you, sign in, change your password and leave the household under Menu → Household — or ask the administrator.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hello <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">your account is now a sub-account of <strong>${esc(hauptkonto)}</strong>. That account can see and change your collection.</p>`,
    note: 'If this was not you, sign in, change your password and leave the household under Menu → Household — or ask the administrator.',
  } : {
    subject: 'BrickInventory Manager — Dein Konto ist einem Haushalt beigetreten',
    title: 'Haushalt verknüpft',
    text: `Hallo ${username},\n\ndein Konto ist jetzt Unterkonto von ${hauptkonto}. Dieses Konto sieht und ändert deine Sammlung.\n\nWarst du das nicht, melde dich an, ändere dein Passwort und verlasse den Haushalt unter Menü → Haushalt — oder wende dich an den Verwalter.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hallo <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">dein Konto ist jetzt Unterkonto von <strong>${esc(hauptkonto)}</strong>. Dieses Konto sieht und ändert deine Sammlung.</p>`,
    note: 'Warst du das nicht, melde dich an, ändere dein Passwort und verlasse den Haushalt unter Menü → Haushalt — oder wende dich an den Verwalter.',
  };
  return sendMail({ to, subject: L.subject, text: L.text,
    html: emailTemplate(L.title, L.subject, `${L.html}${infoBox(L.note, theme)}`, theme) });
}

/** Ohne Mailserver gibt es keinen Hinweis: Die Konsole erreicht den Inhaber nicht. */
export async function mailEingerichtet(): Promise<boolean> {
  return !!(await getSetting('smtp_host')) && !!(await getSetting('smtp_user'));
}

/** Ein Link per Mail kommt nur mit Mailserver UND eigener Adresse an; `neu` sind Werte, die gerade gespeichert werden. */
export async function mailBereit(neu: { smtp_host?: unknown; smtp_user?: unknown } = {}): Promise<boolean> {
  const wert = async (k: 'smtp_host' | 'smtp_user') => neu[k] !== undefined ? String(neu[k] ?? '') : await getSetting(k);
  return !!basisUrl() && !!(await wert('smtp_host')) && !!(await wert('smtp_user'));
}

export type KontoHinweis = 'passkey_neu' | 'passwort_geaendert' | 'passwort_zurueckgesetzt' | 'token_neu' | 'qr_zugang_neu'
  | 'zweiter_faktor_entfernt' | 'verwalter_ernannt' | 'verwaltung_faktor_entfernt' | 'token_wiederverwendet'
  | 'passwort_durch_verwalter' | 'verwaltung_passwort_gesetzt' | 'zweiter_faktor_eingerichtet' | 'zweiter_faktor_abgeschaltet'
  | 'anmeldung_gebremst' | 'bestaetigung_gebremst' | 'einstellungen_geaendert';

/** Ohne Geheimnisse und ohne Link. `haushalt` nennt die Konten, die diese
 * Sammlung sehen: Ein Eindringling könnte sich dort eingetragen haben. */
export async function sendKontoHinweisMail(to: string, username: string, art: KontoHinweis,
                                           o: { lang?: string; passkey?: string; haushalt?: string[]; konto?: string | undefined; durch?: string | undefined } = {}) {
  const theme = await getMailTheme();
  const en = o.lang === 'en';
  const was = {
    passkey_neu: en ? `a new passkey (“${o.passkey ?? ''}”) was added to your account.`
                    : `deinem Konto wurde ein neuer Passkey („${o.passkey ?? ''}“) hinzugefügt.`,
    passwort_geaendert: en ? 'the password of your account was changed.' : 'das Passwort deines Kontos wurde geändert.',
    passwort_zurueckgesetzt: en ? 'the password of your account was reset by email. All sign-ins, app tokens and passkeys were ended.'
                                : 'das Passwort deines Kontos wurde per E-Mail zurückgesetzt. Alle Anmeldungen, App-Zugänge und Passkeys wurden beendet.',
    token_neu: en ? `a new app token (“${o.passkey ?? ''}”) was created for your account.`
                  : `für dein Konto wurde ein neuer App-Zugang („${o.passkey ?? ''}“) erzeugt.`,
    qr_zugang_neu: en ? 'a QR code to sign in the app was created for your account.'
                      : 'für dein Konto wurde ein QR-Code zur Anmeldung der App erzeugt.',
    zweiter_faktor_entfernt: en ? `the administrator “${o.durch ?? ''}” removed the second factor of your account.`
                                : `der Verwalter „${o.durch ?? ''}“ hat den zweiten Faktor deines Kontos entfernt.`,
    verwalter_ernannt: en ? `“${o.durch ?? ''}” made the account “${o.konto ?? ''}” an administrator.`
                          : `„${o.durch ?? ''}“ hat das Konto „${o.konto ?? ''}“ zum Verwalter gemacht.`,
    verwaltung_faktor_entfernt: en ? `“${o.durch ?? ''}” removed the second factor of the account “${o.konto ?? ''}”.`
                                   : `„${o.durch ?? ''}“ hat den zweiten Faktor des Kontos „${o.konto ?? ''}“ entfernt.`,
    passwort_durch_verwalter: en ? `the administrator “${o.durch ?? ''}” set a new password for your account. All sign-ins and app tokens were ended.`
                                 : `der Verwalter „${o.durch ?? ''}“ hat ein neues Passwort für dein Konto gesetzt. Alle Anmeldungen und App-Zugänge wurden beendet.`,
    verwaltung_passwort_gesetzt: en ? `“${o.durch ?? ''}” set a new password for the account “${o.konto ?? ''}”.`
                                    : `„${o.durch ?? ''}“ hat ein neues Passwort für das Konto „${o.konto ?? ''}“ gesetzt.`,
    zweiter_faktor_eingerichtet: en ? 'a second factor (authenticator app) was set up for your account. All other sign-ins and app tokens were ended.'
                                    : 'für dein Konto wurde ein zweiter Faktor (Authenticator-App) eingerichtet. Alle anderen Anmeldungen und App-Zugänge wurden beendet.',
    zweiter_faktor_abgeschaltet: en ? 'the second factor of your account was turned off.' : 'der zweite Faktor deines Kontos wurde abgeschaltet.',
    anmeldung_gebremst: en ? 'there were several failed sign-in attempts for your account; further attempts are slowed down for now.'
                           : 'für dein Konto gab es mehrere fehlgeschlagene Anmeldeversuche; weitere Versuche werden vorerst gebremst.',
    bestaetigung_gebremst: en ? 'in a signed-in session or app of your account, the password or code was entered wrongly several times when confirming; further attempts are slowed down for now.'
                              : 'in einer angemeldeten Sitzung oder App deines Kontos wurde beim Bestätigen mehrmals ein falsches Passwort oder ein falscher Code eingegeben; weitere Versuche werden vorerst gebremst.',
    einstellungen_geaendert: en ? `“${o.durch ?? ''}” changed security-relevant settings: ${o.konto ?? ''}.`
                                : `„${o.durch ?? ''}“ hat sicherheitsrelevante Einstellungen geändert: ${o.konto ?? ''}.`,
    token_wiederverwendet: en ? `an already replaced app token (“${o.passkey ?? ''}”) was used again, so someone has a copy. All tokens of that device were ended; sign in to the app again.`
                              : `ein schon ersetzter App-Zugang („${o.passkey ?? ''}“) wurde erneut benutzt, jemand hat also eine Kopie. Alle Zugänge dieses Geräts sind beendet; melde die App neu an.`,
  }[art];
  const subject = en ? 'BrickInventory Manager — Change to your account' : 'BrickInventory Manager — Änderung an deinem Konto';
  const haushalt = o.haushalt?.length
    ? (en ? `These accounts can see and change your collection: ${o.haushalt.join(', ')}.`
          : `Diese Konten sehen und ändern deine Sammlung: ${o.haushalt.join(', ')}.`) : '';
  const note = en
    ? 'If this was not you, reset your password via “Forgot password”, check Menu → Account and Menu → Household — or ask the administrator.'
    : 'Warst du das nicht, setze dein Passwort über „Passwort vergessen“ zurück und prüfe Menü → Konto und Menü → Haushalt — oder wende dich an den Verwalter.';
  const hallo = en ? 'Hello' : 'Hallo';
  const text = `${hallo} ${username},\n\n${was}\n${haushalt ? `\n${haushalt}\n` : ''}\n${note}\n\nBrickInventory Manager`;
  const html = `<p style="margin:0 0 8px">${hallo} <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">${esc(was)}</p>${haushalt ? `<p style="margin:0 0 16px">${esc(haushalt)}</p>` : ''}`;
  return sendMail({ to, subject, text, html: emailTemplate(en ? 'Account changed' : 'Konto geändert', subject, `${html}${infoBox(note, theme)}`, theme) });
}

// In der Sprache des Kontos, wie die übrigen Mails.
// Ausführlich: docs/begruendungen/src/mail/mailer.ts.md#sendpasswordresetmail
export async function sendPasswordResetMail(to: string, token: string, baseUrl: string, lang = 'de') {
  const theme = await getMailTheme();
  const url = `${baseUrl}/reset-password?token=${token}`;
  const de = lang !== 'en';
  const L = de ? {
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
  } : {
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
  return sendMail({
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
      theme
    ),
  });
}

// Durch emailTemplate() wie die übrigen Mails, damit sie das Design trägt.
// Ausführlich: docs/begruendungen/src/mail/mailer.ts.md#alarmmaildaten
export interface AlarmMailDaten {
  username: string;
  /** Die Sprache des EMPFÄNGERS, nicht die des Servers. */
  lang: string;
  setNumber: string;
  /** Fehlt er, trägt die Mail die Nummer. */
  setName?: string | null;
  condition: string;
  richtung: 'unter' | 'ueber';
  schwelle: number;
  preis: number;
  waehrung: string;
}

// Ausführlich: docs/begruendungen/src/mail/mailer.ts.md#bauealarmmail
export async function baueAlarmMail(d: AlarmMailDaten): Promise<{ subject: string; text: string; html: string; link?: string }> {
  const theme = await getMailTheme();
  const de = d.lang !== 'en';
  const geld = (n: number) => `${d.waehrung} ${n.toFixed(2)}`;
  const zustand = d.condition === 'U'
    ? (de ? 'gebraucht' : 'used') : (de ? 'neu' : 'new');
  const richtung = d.richtung === 'unter'
    ? (de ? 'unter' : 'below') : (de ? 'über' : 'above');
  const titel = d.setName || d.setNumber;

  // Der Link ist OPTIONAL: Der Preislauf hat keine Anfrage; ohne APP_BASE_URL
  // bleibt die Mail ohne Knopf, statt auf einen geratenen Host zu zeigen.
  const basis = basisUrl();
  if (!basis) hinweisOhneBasisUrl('mailer',
    'die Preisalarm-Mail geht OHNE den Knopf „Set ansehen" hinaus. Der Preislauf hat keine Anfrage, aus der sich der Host ableiten liesse; ohne die Variable gaebe es nur einen geratenen Link.');
  const url = basis ? `${basis}/?set=${encodeURIComponent(d.setNumber)}` : '';

  const subject = de
    ? `Preisalarm: ${d.setNumber} liegt ${richtung} ${geld(d.schwelle)}`
    : `Price alert: ${d.setNumber} is ${richtung} ${geld(d.schwelle)}`;

  // Der Klartext geht als text/plain mit; manche Programme zeigen nur ihn.
  const text = de
    ? `Hallo ${d.username},\n\n` +
      `der Marktpreis für ${d.setNumber} (${zustand}) liegt bei ${geld(d.preis)} ` +
      `und damit ${richtung} deiner Schwelle von ${geld(d.schwelle)}.\n\n` +
      `Diese Meldung kommt einmal je Übergang: Erst wenn der Preis wieder auf ` +
      `die andere Seite wechselt, kann sie erneut ausgelöst werden.\n`
    : `Hi ${d.username},\n\n` +
      `the market price for ${d.setNumber} (${zustand}) is ${geld(d.preis)}, ` +
      `which is ${richtung} your threshold of ${geld(d.schwelle)}.\n\n` +
      `You get this once per crossing: it can only trigger again after the ` +
      `price has moved back to the other side.\n`;

  // Marktpreis und Schwelle gross nebeneinander — die einzige Frage dieser Mail.
  // Tabelle statt flex wegen Outlook.
  const zahlen = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 20px;table-layout:fixed">
    <tr>
      <td width="44%" style="width:44%;background:${theme.bg};border:1px solid ${theme.border};border-radius:8px;
                 padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px">${de ? 'Marktpreis' : 'Market price'}</div>
        <div style="font-size:22px;font-weight:700;color:${theme.primary}">${esc(geld(d.preis))}</div>
      </td>
      <td width="12%" style="width:12%;font-size:0;line-height:0">&nbsp;</td>
      <td width="44%" style="width:44%;background:${theme.bg};border:1px solid ${theme.border};border-radius:8px;
                 padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px">${de ? 'Deine Schwelle' : 'Your threshold'}</div>
        <div style="font-size:22px;font-weight:700;color:${theme.text}">${esc(geld(d.schwelle))}</div>
      </td>
    </tr>
  </table>`;

  const einleitung = de
    ? `<p style="margin:0 0 8px">Hallo <strong>${esc(d.username)}</strong>,</p>
       <p style="margin:0 0 20px">der Marktpreis für <strong>${esc(titel)}</strong>
          (${esc(d.setNumber)}, ${esc(zustand)}) liegt <strong>${esc(richtung)}</strong> deiner Schwelle.</p>`
    : `<p style="margin:0 0 8px">Hi <strong>${esc(d.username)}</strong>,</p>
       <p style="margin:0 0 20px">the market price for <strong>${esc(titel)}</strong>
          (${esc(d.setNumber)}, ${esc(zustand)}) is <strong>${esc(richtung)}</strong> your threshold.</p>`;

  const hinweis = de
    ? 'Diese Meldung kommt <strong>einmal je Übergang</strong>. Erst wenn der Preis wieder auf die andere Seite wechselt, kann sie erneut ausgelöst werden.'
    : 'You get this <strong>once per crossing</strong>. It can only trigger again after the price has moved back to the other side.';

  return {
    subject,
    text,
    ...(url ? { link: url } : {}),
    html: emailTemplate(
      de ? 'Preisalarm' : 'Price alert',
      de ? `${d.setNumber} liegt ${richtung} ${geld(d.schwelle)}.`
         : `${d.setNumber} is ${richtung} ${geld(d.schwelle)}.`,
      `${einleitung}
       ${zahlen}
       ${url ? emailBtn(url, de ? '🔔  Set ansehen' : '🔔  View set', theme) : ''}
       ${infoBox(hinweis, theme)}
       ${DIVIDER}
       <p style="margin:0;font-size:13px;color:#6b7280">
         ${de ? 'Du bekommst diese Mail, weil du für dieses Set einen Preisalarm gesetzt hast.'
              : 'You receive this email because you set a price alert for this set.'}
       </p>`,
      theme
    ),
  };
}

