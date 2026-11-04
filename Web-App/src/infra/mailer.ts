// Ausführlich: docs/begruendungen/src/infra/mailer.ts.md#abschnitt

import nodemailer from 'nodemailer';
import tls from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import { konfig } from './konfig';
import { getGlobalSetting } from '../konto/settings';
import addressparser from 'nodemailer/lib/addressparser';
import { ausTabelle, emailGueltig } from './validate';
import { fehlertext } from './httpError';
import { basisUrl, hinweisOhneBasisUrl } from './basisUrl';
const getSetting = (key: string) => getGlobalSetting(key, '');

function normiereFingerabdruck(wert: unknown): string {
  return String(wert ?? '').replace(/[\s:]/g, '').toUpperCase();
}

/** Die Prüfung bleibt an: Ein selbst signiertes Zertifikat kommt als PEM herein; ein
 * Fingerabdruck nagelt genau eines fest und ersetzt den Abgleich des Hostnamens. */
async function getTransporter() {
  const host   = await getSetting('smtp_host');
  const port   = parseInt(await getSetting('smtp_port') || '587');
  const user   = await getSetting('smtp_user');
  const pass   = await getSetting('smtp_pass');
  const secure = (await getSetting('smtp_secure')) === '1';
  const ca     = (await getSetting('smtp_tls_ca')).trim();
  const fp     = normiereFingerabdruck(await getSetting('smtp_tls_fingerprint'));
  if (!host || !user) return null;
  const pruefeGegenstelle = (name: string, zert: PeerCertificate) => {
    if (!fp) return tls.checkServerIdentity(name, zert);
    if (normiereFingerabdruck(zert.fingerprint256) === fp) return undefined;
    return Object.assign(new Error(`Fingerabdruck ${zert.fingerprint256} ist nicht der eingetragene`), { code: 'SMTP_FINGERABDRUCK' });
  };
  // requireTLS: Ohne STARTTLS in der EHLO-Antwort fiele nodemailer sonst auf
  // Klartext zurück und schickte Passwort und Rücksetzlinks lesbar durchs Netz.
  return nodemailer.createTransport({
    host, port, secure, requireTLS: !secure, auth: { user, pass },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', checkServerIdentity: pruefeGegenstelle, ...(ca ? { ca } : {}) },
    connectionTimeout: 10000, greetingTimeout: 8000, socketTimeout: 10000,
  });
}

const ZERTIFIKATSFEHLER = new Set(['SMTP_FINGERABDRUCK', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']);

/** Ein Zertifikatsfehler sagt dem Verwalter, was er eintragen muss, statt nur den Code. */
function smtpFehlertext(e: unknown): { text: string; zertifikat: boolean } {
  const code = String((e as { code?: unknown; cause?: { code?: unknown } })?.code ?? '');
  const ursache = String((e as { cause?: { code?: unknown } })?.cause?.code ?? '');
  const zertifikat = ZERTIFIKATSFEHLER.has(code) || ZERTIFIKATSFEHLER.has(ursache) || /certificate|Fingerabdruck/i.test(fehlertext(e));
  const ohneStarttls = code === 'ETLS' && /upgrading connection with STARTTLS/.test(fehlertext(e));
  return { zertifikat, text: zertifikat
    ? `Zertifikat des Mailservers nicht bestätigt (${fehlertext(e)}). Unter Menü → Einstellungen → E-Mail das Zertifikat (PEM) oder seinen SHA-256-Fingerabdruck eintragen.`
    : ohneStarttls
      ? 'Der Mailserver bietet kein STARTTLS an; unverschlüsselt wird nichts gesendet. Port 465 mit „SSL/TLS" wählen oder STARTTLS am Mailserver einschalten.'
      : fehlertext(e) };
}

/** Wer die entfallene Ausnahme „Zertifikat nicht prüfen" gesetzt hatte, erfährt es beim Start. */
export async function meldeSmtpAltlast(): Promise<boolean> {
  if ((await getSetting('smtp_insecure_tls')) !== '1') return false;
  console.warn('⚠️  [mailer] smtp_insecure_tls wird nicht mehr ausgewertet: Das Zertifikat des Mailservers wird jetzt geprüft. ' +
    'Für ein selbst signiertes Zertifikat unter Menü → Einstellungen → E-Mail das Zertifikat (PEM) oder den SHA-256-Fingerabdruck eintragen.');
  return true;
}

async function getFrom() {
  return (await getSetting('smtp_from')) || 'BrickInventory Manager <noreply@brickinventory.local>';
}

/** Ohne Token, ausser mit MAIL_KONSOLE_MIT_TOKEN=1: Die Konsole landet in
 * app_logs, und ein Reset-Link ist ein Zugang zum Konto. NODE_ENV taugt dafür
 * nicht — „development" steht schnell auf einem echten Server. Der Link kommt
 * vom Absender, nicht aus dem Text: Dort kann eine Eingabe eine fremde URL vorschieben. */
export function linkFuerKonsole(link?: string, schalter = konfig().mailKonsoleMitToken ? '1' : undefined): string | null {
  const url = link && /^https?:\/\/\S+$/.test(link) ? link : null;
  if (!url) return null;
  return schalter === '1' ? url : url.replace(/([?&]token=)[^&#\s]+/g, '$1…');
}

/** Die Konsole landet in app_logs, das jeder Verwalter liest; voll nur mit dem Entwicklerschalter wie die Links. */
export function maskiereAdresse(adresse: string, voll = konfig().mailKonsoleMitToken): string {
  if (voll) return adresse;
  const at = adresse.lastIndexOf('@');
  return at < 1 ? '…' : `${adresse[0]}…${adresse.slice(at)}`;
}

/** Die Zeichenkette muss für nodemailer genau diese eine Adresse sein, sonst
 * ginge die Mail an eine andere als die geprüfte (Anzeigename, Liste). */
export function einzigerEmpfaenger(to: string): boolean {
  const liste = emailGueltig(to) ? addressparser(to, { flatten: true }) : [];
  return liste.length === 1 && liste[0]!.address === to && !liste[0]!.name;
}

/** Ohne SMTP auf der Konsole; `html` und `text` optional, weil die Konsole
 * nur `text` liest. */
export async function sendMail({ to, subject, html, text, link: echterLink }: {
  to: string; subject: string; html?: string; text?: string; link?: string;
}) {
  if (!einzigerEmpfaenger(to)) {
    console.warn(`📧 Empfänger abgelehnt (${maskiereAdresse(to)}): keine einzelne reine Adresse`);
    return { success: false, error: 'empfaenger_ungueltig', mode: 'smtp' };
  }
  const transporter = await getTransporter();
  const from = await getFrom();
  if (!transporter) {
    const link = linkFuerKonsole(echterLink);
    console.log('\n══════════════════════════════════════════════════');
    console.log('📧  E-Mail (SMTP nicht konfiguriert):');
    console.log(`    An:      ${maskiereAdresse(to)}`);
    console.log(`    Betreff: ${subject}`);
    if (link) console.log(`    Link:    ${link}`);
    console.log('══════════════════════════════════════════════════\n');
    return { success: true, mode: 'console' };
  }
  try {
    const absender = addressparser(from, { flatten: true })[0]?.address;
    const info = await transporter.sendMail({ from, to, subject, text, html,
      ...(absender ? { envelope: { from: absender, to: [to] } } : {}) });
    console.log(`📧 E-Mail gesendet an ${maskiereAdresse(to)}: ${info.messageId}`);
    return { success: true, mode: 'smtp', messageId: info.messageId };
  } catch (e) {
    const { text } = smtpFehlertext(e);
    console.error(`📧 SMTP Fehler (${maskiereAdresse(to)}):`, text);
    return { success: false, error: text, mode: 'smtp' };
  }
}

/** `unknown`: Hier laufen Werte aus Datenbank und Formularen hinein. */
function esc(s: unknown) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Das Logo als HTML-Tabellen: Outlook und Gmail rendern kein SVG.
const LOGO_HTML = `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 18px">
  <tr><td>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <!-- Dachfläche (oben, dunkler) -->
      <tr>
        <td colspan="4" style="height:8px;background:#cc2a21;border-radius:3px 3px 0 0;font-size:0;line-height:0">&nbsp;</td>
        <td style="width:7px;height:8px;background:#b5231c;font-size:0;line-height:0">&nbsp;</td>
      </tr>
      <!-- Noppen-Reihe -->
      <tr>
        <td colspan="4" style="background:#e63329;padding:0 4px 0 6px">
          <table role="presentation" cellspacing="3" cellpadding="0" border="0">
            <tr>
              <td style="width:10px;height:6px;background:#cc2a21;border-radius:3px 3px 0 0;font-size:0">&nbsp;</td>
              <td style="width:10px;height:6px;background:#cc2a21;border-radius:3px 3px 0 0;font-size:0">&nbsp;</td>
              <td style="width:10px;height:6px;background:#cc2a21;border-radius:3px 3px 0 0;font-size:0">&nbsp;</td>
              <td style="width:10px;height:6px;background:#cc2a21;border-radius:3px 3px 0 0;font-size:0">&nbsp;</td>
            </tr>
          </table>
        </td>
        <td style="width:7px;background:#b5231c;font-size:0">&nbsp;</td>
      </tr>
      <!-- Frontfläche mit Label -->
      <tr>
        <td style="width:6px;background:#e63329;font-size:0">&nbsp;</td>
        <td colspan="3" style="background:#e63329;padding:5px 5px 6px 4px">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"
                 style="background:#ffffff;border-radius:3px;padding:4px 5px;width:66px">
            <tr>
              <td style="background:#f5a800;border-radius:2px;padding:3px 0;text-align:center">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:900;color:#ffffff;letter-spacing:1.5px">BIM</span>
              </td>
            </tr>
            <tr><td style="height:4px;font-size:0;line-height:0">&nbsp;</td></tr>
            <tr><td style="height:4px;background:#e5e7eb;border-radius:1px;font-size:0;line-height:0">&nbsp;</td></tr>
            <tr><td style="height:3px;font-size:0;line-height:0">&nbsp;</td></tr>
            <tr><td style="width:48px;height:4px;background:#e5e7eb;border-radius:1px;font-size:0;line-height:0">&nbsp;</td></tr>
          </table>
        </td>
        <td style="width:7px;background:#b5231c;font-size:0">&nbsp;</td>
      </tr>
      <!-- Unterkante -->
      <tr>
        <td colspan="4" style="height:6px;background:#e63329;border-radius:0 0 0 3px;font-size:0">&nbsp;</td>
        <td style="width:7px;height:6px;background:#b5231c;border-radius:0 0 3px 0;font-size:0">&nbsp;</td>
      </tr>
    </table>
  </td></tr>
</table>`;

/** ABGELEITET aus MAIL_THEMES.classic: Eine zweite Aufzählung der Felder
 * veraltete beim nächsten neuen Feld still. */
type MailTheme = typeof MAIL_THEMES.classic;

export const MAIL_THEMES = {
  classic: {
    primary:  '#2563eb',   // --b600
    primaryD: '#1d4ed8',
    bg:       '#f1f5f9',   // --s100
    surface:  '#ffffff',
    text:     '#0f172a',
    muted:    '#6b7280',
    border:   '#e5e7eb',
    radius:   '10px',
    studs:    false,
  },
  brick: {
    primary:  '#3d5a80',   // --b600 aus themes/brick.css
    primaryD: '#2f4763',   // --b700
    bg:       '#c9d5e2',   // --bg
    surface:  '#ffffff',
    text:     '#2d4763',
    muted:    '#5b7290',
    border:   '#b7cbe0',   // --b200
    radius:   '14px',      // --rad
    studs:    true,        // Noppenleiste über dem Kopfbereich
  },
};

/** Bei jedem Zweifel `classic`: Eine Mail soll nie am Design scheitern. */
export async function getMailTheme() {
  try {
    const gespeichert = await getGlobalSetting('app_theme');
    // ausTabelle: Ein Wert aus der Datenbank wie 'constructor' fände sonst ein
    // geerbtes Mitglied, und der Rückfall griffe nie.
    return ausTabelle(MAIL_THEMES, gespeichert, MAIL_THEMES.classic);
  } catch (_) { return MAIL_THEMES.classic; }
}

export function emailTemplate(title: string, preheader: string, content: string, theme: MailTheme = MAIL_THEMES.classic) {
  return `<!DOCTYPE html>
<html lang="de" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${esc(title)}</title>
  <style>
    body,table,td,p,a,li,blockquote{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;margin:0;padding:0}
    body{background:${theme.bg};font-family:Arial,Helvetica,sans-serif}
    img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none}
    .btn-link{background:${theme.primary};color:#ffffff!important;text-decoration:none;display:inline-block;
              padding:13px 32px;border-radius:8px;font-weight:700;font-size:15px;font-family:Arial,Helvetica,sans-serif}
    @media only screen and (max-width:600px){
      .container{width:100%!important}
      .content-pad{padding:24px 20px!important}
    }
  </style>
</head>
<body style="background:${theme.bg};margin:0;padding:0">
  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:${theme.bg}">${esc(preheader)}&nbsp;</div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${theme.bg};padding:32px 16px">
    <tr><td align="center">

      <!-- Card wrapper -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="520" class="container"
             style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">

        <!-- Blue header -->
        <tr>
          <td style="background:${theme.primary};padding:32px 36px 28px;text-align:center">
            ${LOGO_HTML}
            <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#ffffff;
                       font-family:Arial,Helvetica,sans-serif;letter-spacing:-.3px">
              BrickInventory Manager
            </h1>
            <p style="margin:0;font-size:14px;color:rgba(255,255,255,.8);font-family:Arial,Helvetica,sans-serif">
              ${esc(title)}
            </p>
          </td>
        </tr>

        <!-- White body -->
        <tr>
          <td class="content-pad" style="padding:32px 36px;background:#ffffff;
               color:#374151;font-size:15px;line-height:1.7;font-family:Arial,Helvetica,sans-serif">
            ${content}
          </td>
        </tr>

        <!-- Light footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;
               padding:18px 36px;text-align:center">
            <p style="margin:0;font-size:12px;color:#94a3b8;font-family:Arial,Helvetica,sans-serif">
              BrickInventory Manager &mdash; automatisch generierte E-Mail
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Tabellen statt flex: Outlook kennt kein flex.
function emailBtn(url: string, text: string, theme: MailTheme = MAIL_THEMES.classic) {
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:28px auto 12px">
    <tr>
      <td style="border-radius:8px;background:${theme.primary};text-align:center">
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="17%" stroke="f" fillcolor="${theme.primary}"><w:anchorlock/><center><![endif]-->
        <a href="${url}" class="btn-link"
           style="background:${theme.primary};color:#ffffff;text-decoration:none;display:inline-block;
                  padding:13px 32px;border-radius:8px;font-weight:700;font-size:15px;
                  font-family:Arial,Helvetica,sans-serif;mso-hide:all">
          ${esc(text)}
        </a>
        <!--[if mso]></center></v:roundrect><![endif]-->
      </td>
    </tr>
  </table>
  <p style="margin:0 0 16px;font-size:12px;color:#94a3b8;text-align:center;word-break:break-all;
             font-family:Arial,Helvetica,sans-serif">
    Oder kopiere diesen Link:
    <a href="${url}" style="color:${theme.primary}">${url}</a>
  </p>`;
}

// Ausführlich: docs/begruendungen/src/infra/mailer.ts.md#infobox
function infoBox(text: string, theme: MailTheme = MAIL_THEMES.classic) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px">
    <tr>
      <td style="background:${theme.bg};border:1px solid ${theme.border};border-radius:8px;
                 padding:12px 16px;font-size:13px;color:${theme.text};font-family:Arial,Helvetica,sans-serif">
        ${text}
      </td>
    </tr>
  </table>`;
}

const DIVIDER = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:20px 0">
  <tr><td style="height:1px;background:#e2e8f0;font-size:0;line-height:0">&nbsp;</td></tr>
</table>`;

/** Ohne Namen: Die Adresse ist unbestätigt, und Name wie Benutzername wählt,
 * wer registriert — eine Anrede daraus trüge fremden Text in eine Mail des Servers. */
export async function sendVerificationMail(to: string, token: string, baseUrl: string, lang = 'de') {
  // Beim Versand laden: Das Design kann sich zwischen zwei Mails geändert haben.
  const theme = await getMailTheme();
  const url = `${baseUrl}/verify?token=${token}`;
  const L = lang === 'en' ? {
    subject: 'BrickInventory Manager — Confirm your email',
    text: `Hello,\n\nplease confirm your email address:\n${url}\n\nThe link is valid for 24 hours.\n\nBrickInventory Manager`,
    title: 'Confirm email',
    preheader: 'Please confirm your email address.',
    greetHtml: `<p style="margin:0 0 8px">Hello,</p>
       <p style="margin:0 0 20px">welcome to BrickInventory Manager! Please confirm your email address to activate your account.</p>`,
    btn: '✓  Confirm email',
    note: `<p style="margin:0;font-size:13px;color:#6b7280">
         The link is valid for <strong>24 hours</strong>.<br>
         If you did not sign up, you can safely ignore this email.
       </p>`,
  } : {
    subject: 'BrickInventory Manager — E-Mail bestätigen',
    text: `Hallo,\n\nbitte bestätige deine E-Mail-Adresse:\n${url}\n\nDer Link ist 24 Stunden gültig.\n\nBrickInventory Manager`,
    title: 'E-Mail bestätigen',
    preheader: 'Bitte bestätige deine E-Mail-Adresse.',
    greetHtml: `<p style="margin:0 0 8px">Hallo,</p>
       <p style="margin:0 0 20px">willkommen bei BrickInventory Manager! Bitte bestätige deine E-Mail-Adresse um dein Konto zu aktivieren.</p>`,
    btn: '✓  E-Mail bestätigen',
    note: `<p style="margin:0;font-size:13px;color:#6b7280">
         Der Link ist <strong>24 Stunden</strong> gültig.<br>
         Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren.
       </p>`,
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
       ${DIVIDER}
       ${L.note}`,
      theme
    ),
  });
}

export async function sendEmailGeaendertMail(to: string, username: string, neueAdresse: string, lang = 'de') {
  const theme = await getMailTheme();
  const L = lang === 'en' ? {
    subject: 'BrickInventory Manager — Your email address was changed',
    title: 'Email address changed',
    text: `Hello ${username},\n\nthe email address of your account was changed to ${neueAdresse}.\n\nIf this was not you, sign in, change your password and set the old address again — or ask the administrator.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hello <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">the email address of your account was changed to <strong>${esc(neueAdresse)}</strong>.</p>`,
    note: 'If this was not you, sign in, change your password and set the old address again — or ask the administrator.',
  } : {
    subject: 'BrickInventory Manager — Deine E-Mail-Adresse wurde geändert',
    title: 'E-Mail-Adresse geändert',
    text: `Hallo ${username},\n\ndie E-Mail-Adresse deines Kontos wurde auf ${neueAdresse} geändert.\n\nWarst du das nicht, melde dich an, ändere dein Passwort und trage die alte Adresse wieder ein — oder wende dich an den Verwalter.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hallo <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">die E-Mail-Adresse deines Kontos wurde auf <strong>${esc(neueAdresse)}</strong> geändert.</p>`,
    note: 'Warst du das nicht, melde dich an, ändere dein Passwort und trage die alte Adresse wieder ein — oder wende dich an den Verwalter.',
  };
  return sendMail({ to, subject: L.subject, text: L.text,
    html: emailTemplate(L.title, L.subject, `${L.html}${infoBox(L.note, theme)}`, theme) });
}

/** Die Registrierung antwortet auf eine vergebene Adresse wie auf eine neue; das hier erfährt ihr Inhaber. */
export async function sendRegistrierungsVersuchMail(to: string, username: string, lang = 'de') {
  const theme = await getMailTheme();
  const L = lang === 'en' ? {
    subject: 'BrickInventory Manager — Registration with your email address',
    title: 'Registration attempt',
    text: `Hello ${username},\n\nsomeone tried to register a new account with your email address. You already have an account; nothing was changed.\n\nIf you forgot your password, use “Forgot password” on the sign-in page.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hello <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 16px">someone tried to register a new account with your email address. You already have an account; nothing was changed.</p>`,
    note: 'If you forgot your password, use “Forgot password” on the sign-in page.',
  } : {
    subject: 'BrickInventory Manager — Registrierung mit deiner E-Mail-Adresse',
    title: 'Registrierungsversuch',
    text: `Hallo ${username},\n\njemand hat versucht, mit deiner E-Mail-Adresse ein neues Konto anzulegen. Du hast schon eines; geändert wurde nichts.\n\nHast du dein Passwort vergessen, nutze „Passwort vergessen“ auf der Anmeldeseite.\n\nBrickInventory Manager`,
    html: `<p style="margin:0 0 8px">Hallo <strong>${esc(username)}</strong>,</p>
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

export type KontoHinweis = 'passkey_neu' | 'passwort_geaendert' | 'passwort_zurueckgesetzt' | 'token_neu' | 'qr_zugang_neu'
  | 'zweiter_faktor_entfernt' | 'verwalter_ernannt' | 'verwaltung_faktor_entfernt' | 'token_wiederverwendet'
  | 'passwort_durch_verwalter' | 'verwaltung_passwort_gesetzt' | 'zweiter_faktor_eingerichtet' | 'zweiter_faktor_abgeschaltet'
  | 'anmeldung_gebremst' | 'einstellungen_geaendert';

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
// Ausführlich: docs/begruendungen/src/infra/mailer.ts.md#sendpasswordresetmail
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
// Ausführlich: docs/begruendungen/src/infra/mailer.ts.md#alarmmaildaten
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

// Ausführlich: docs/begruendungen/src/infra/mailer.ts.md#bauealarmmail
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

export async function testSmtp() {
  const transporter = await getTransporter();
  // Code statt Satz: testSmtp() kennt den Anfragenden nicht.
  if (!transporter) return { success: false as const, code: 'smtp_nicht_konfiguriert' as const };
  try {
    await transporter.verify();
    return { success: true as const, message: 'SMTP-Verbindung erfolgreich' };
  } catch (e) {
    const { text, zertifikat } = smtpFehlertext(e);
    return zertifikat ? { success: false as const, code: 'smtp_zertifikat' as const, vars: { grund: fehlertext(e) } }
      : { success: false as const, code: 'smtp_fehler' as const, vars: { grund: text } };
  }
}

// Mitexportiert, damit sich das Design einer Mail ohne Versand prüfen lässt.

