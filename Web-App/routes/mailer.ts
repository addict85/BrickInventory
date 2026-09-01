/**
 * Mailer — sends emails via nodemailer.
 * Design: blue/white, matching the webapp (--b600: #2563eb).
 */

// Zentraler Settings-Helfer — lokale Kopie entfernt
import { getGlobalSetting } from '../utils/settings';
import { ausTabelle } from '../utils/validate';
import { fehlertext } from '../utils/httpError';
const getSetting = (key: string) => getGlobalSetting(key, '');

/**
 * Verbindung zum Mailserver.
 *
 * ── Zertifikatsprüfung ──────────────────────────────────────────────────────
 * Hier stand fest verdrahtet `rejectUnauthorized: false` — die einzige Stelle
 * im ganzen Projekt, die eine TLS-Prüfung abschaltete. Damit ging die
 * SMTP-Anmeldung (Benutzer und Passwort) und jeder Link zum
 * Passwort-Zurücksetzen über eine Verbindung, deren Gegenstelle nicht
 * überprüft wurde: Wer sich dazwischenhängt, bekommt beides.
 *
 * Für ein selbst signiertes Zertifikat im Heimnetz ist das Abschalten
 * nachvollziehbar — deshalb bleibt es möglich, aber als bewusste Entscheidung
 * unter `smtp_insecure_tls` (Einstellungen → E-Mail). Vorgabe ist jetzt
 * PRÜFEN; wer nichts einstellt, ist geschützt.
 */
async function getTransporter() {
  const nodemailer = require('nodemailer');
  const host   = await getSetting('smtp_host');
  const port   = parseInt(await getSetting('smtp_port') || '587');
  const user   = await getSetting('smtp_user');
  const pass   = await getSetting('smtp_pass');
  const secure = (await getSetting('smtp_secure')) === '1';
  const unsicher = (await getSetting('smtp_insecure_tls')) === '1';
  if (!host || !user) return null;
  if (unsicher) {
    console.warn('⚠️  [mailer] smtp_insecure_tls ist aktiv — das Zertifikat des Mailservers wird NICHT geprüft.');
  }
  return nodemailer.createTransport({
    host, port, secure, auth: { user, pass },
    tls: { rejectUnauthorized: !unsicher },
    connectionTimeout: 10000, greetingTimeout: 8000, socketTimeout: 10000,
  });
}

async function getFrom() {
  return (await getSetting('smtp_from')) || 'BrickInventory Manager <noreply@brickinventory.local>';
}

/**
 * Eine E-Mail verschicken — oder, ohne SMTP, auf der Konsole zeigen.
 *
 * `html` und `text` sind optional, weil beide Aufrufwege vorkommen: Die
 * Konsolenausgabe unten liest `text`, der Versand schickt beides mit.
 */
async function sendMail({ to, subject, html, text }: {
  to: string; subject: string; html?: string; text?: string;
}) {
  const transporter = await getTransporter();
  const from = await getFrom();
  if (!transporter) {
    const urlMatch = (text || '').match(/https?:\/\/\S+/);
    console.log('\n══════════════════════════════════════════════════');
    console.log('📧  E-Mail (SMTP nicht konfiguriert):');
    console.log(`    An:      ${to}`);
    console.log(`    Betreff: ${subject}`);
    if (urlMatch) console.log(`    Link:    ${urlMatch[0]}`);
    console.log('══════════════════════════════════════════════════\n');
    return { success: true, mode: 'console' };
  }
  try {
    const info = await transporter.sendMail({ from, to, subject, text, html });
    console.log(`📧 E-Mail gesendet an ${to}: ${info.messageId}`);
    return { success: true, mode: 'smtp', messageId: info.messageId };
  } catch (e) {
    console.error(`📧 SMTP Fehler (${to}):`, fehlertext(e));
    return { success: false, error: fehlertext(e), mode: 'smtp' };
  }
}

/**
 * Maskiert `&`, `<` und `>` fuer die Ausgabe in HTML.
 *
 * Der Parameter ist `unknown` und nicht `string`: Hier laufen Werte aus der
 * Datenbank und aus Formularen hinein, und `String(s || '')` faengt genau das
 * ab. Ein `string`-Typ waere eine Behauptung ueber die Aufrufer, die dieser
 * Rumpf gar nicht braucht.
 */
function esc(s: unknown) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Logo: HTML-Tabellen-Nachbau des Login-Seite-SVG ─────────────────────────
// Das SVG der Login-Seite wird 1:1 als HTML-Tabellen nachgebaut,
// da SVG in E-Mail-Clients (Outlook, Gmail) nicht gerendert wird.
// Rot (#e63329) mit Noppen, weissem Label-Bereich, gelbem BIM-Badge.
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

// ── E-Mail-Template: blau/weiss, analog Webapp ────────────────────────────────

/**
 * Farbpalette je Design.
 *
 * E-Mails kennen keine CSS-Variablen und kein externes Stylesheet — jeder Wert
 * muss direkt im Markup stehen. Die Paletten sind daher aus themes/*.css bzw.
 * styles.css abgeleitet und hier gespiegelt.
 *
 * Das Design ist eine GLOBALE Einstellung (`app_theme` in global_settings),
 * nicht pro Nutzer — der Mailer liest sie beim Versand.
 */
/**
 * Ein Mail-Design. ABGELEITET aus MAIL_THEMES.classic, nicht danebengeschrieben:
 * Eine zweite Aufzaehlung der neun Felder waere eine zweite Wahrheit, die beim
 * naechsten neuen Feld still veraltet.
 */
type MailTheme = typeof MAIL_THEMES.classic;

const MAIL_THEMES = {
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

/**
 * Aktuelles Design laden. Fällt bei jedem Zweifel auf `classic` zurück — eine
 * E-Mail soll nie am Design scheitern.
 */
async function getMailTheme() {
  try {
    const db = require('../db/database');
    const row = await db.get("SELECT value FROM global_settings WHERE key='app_theme'");
    // ausTabelle statt MAIL_THEMES[...]: Ein Indexzugriff mit einem Wert aus
    // der Datenbank liefert auch GEERBTE Mitglieder — bei 'constructor' oder
    // '__proto__' kaeme etwas Wahres zurueck, und der ||-Rueckfall griffe nie.
    // Die Schreibroute (routes/settings.ts) prueft heute gegen eine
    // Positivliste, es ist also nicht erreichbar; aber utils/indexHtml.ts
    // prueft an der LESESTELLE, und das ist der Stand, auf den diese hier
    // gehoert. Eine Absicherung drei Dateien entfernt ist keine dieser Stelle.
    return ausTabelle(MAIL_THEMES, row?.value, MAIL_THEMES.classic);
  } catch (_) { return MAIL_THEMES.classic; }
}

function emailTemplate(title: string, preheader: string, content: string, theme: MailTheme = MAIL_THEMES.classic) {
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

// ── Button helper (Outlook-kompatibel via table) ───────────────────────────────
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

// ── Info-Box (hellblau, wie .ibox in der Webapp) ──────────────────────────────
/**
 * Hinweiskasten in der Mail.
 *
 * ── Der Parameter war da und wurde ignoriert ────────────────────────────────
 * `theme` stand seit jeher in der Signatur, aber die Farben waren fest
 * verdrahtet (#eff6ff/#bfdbfe/#1e40af — das Blau des klassischen Designs). Im
 * Stein-Design blieb der Kasten deshalb blau, waehrend Kopf, Knopf und
 * Hintergrund umschalteten.
 *
 * Gefunden von noUnusedParameters: Ein Parameter, den niemand liest, ist
 * entweder ueberfluessig — oder er sollte benutzt werden und wurde vergessen.
 * Hier das Zweite; mail-theme.test.js prueft seit jeher, dass die Funktion ihn
 * ENTGEGENNIMMT, und genau das war zu wenig.
 *
 * `border` und `text` kommen aus dem Design, der Hintergrund bleibt eine helle
 * Tonung: `surface` waere weiss und der Kasten damit unsichtbar.
 */
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

// ── Divider ───────────────────────────────────────────────────────────────────
const DIVIDER = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:20px 0">
  <tr><td style="height:1px;background:#e2e8f0;font-size:0;line-height:0">&nbsp;</td></tr>
</table>`;

// ── Bestätigungsmail ──────────────────────────────────────────────────────────
async function sendVerificationMail(to: string, username: string, token: string, baseUrl: string, lang = 'de') {
  // Design beim Versand laden — es ist eine globale Einstellung und kann sich
  // zwischen zwei Mails geändert haben.
  const theme = await getMailTheme();
  const url = `${baseUrl}/verify?token=${token}`;
  const L = lang === 'en' ? {
    subject: 'BrickInventory Manager — Confirm your email',
    text: `Hello ${username},\n\nplease confirm your email address:\n${url}\n\nThe link is valid for 24 hours.\n\nBrickInventory Manager`,
    title: 'Confirm email',
    preheader: `Please confirm your email address, ${username}.`,
    greetHtml: `<p style="margin:0 0 8px">Hello <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 20px">welcome to BrickInventory Manager! Please confirm your email address to activate your account.</p>`,
    btn: '✓  Confirm email',
    note: `<p style="margin:0;font-size:13px;color:#6b7280">
         The link is valid for <strong>24 hours</strong>.<br>
         If you did not sign up, you can safely ignore this email.
       </p>`,
  } : {
    subject: 'BrickInventory Manager — E-Mail bestätigen',
    text: `Hallo ${username},\n\nbitte bestätige deine E-Mail-Adresse:\n${url}\n\nDer Link ist 24 Stunden gültig.\n\nBrickInventory Manager`,
    title: 'E-Mail bestätigen',
    preheader: `Bitte bestätige deine E-Mail-Adresse, ${username}.`,
    greetHtml: `<p style="margin:0 0 8px">Hallo <strong>${esc(username)}</strong>,</p>
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

// ── Passwort-Reset-Mail ───────────────────────────────────────────────────────
async function sendPasswordResetMail(to: string, username: string, token: string, baseUrl: string) {
  const theme = await getMailTheme();
  const url = `${baseUrl}/reset-password?token=${token}`;
  return sendMail({
    to,
    subject: 'BrickInventory Manager — Passwort zurücksetzen',
    text: `Hallo ${username},\n\nPasswort zurücksetzen:\n${url}\n\nGültig 1 Stunde.\n\nBrickInventory Manager`,
    html: emailTemplate(
      'Passwort zurücksetzen',
      `Setze dein Passwort für BrickInventory Manager zurück.`,
      `<p style="margin:0 0 8px">Hallo <strong>${esc(username)}</strong>,</p>
       <p style="margin:0 0 20px">du hast eine Passwort-Rücksetzung angefordert. Klicke auf den Button um ein neues Passwort zu setzen.</p>
       ${emailBtn(url, '🔑  Passwort zurücksetzen', theme)}
       ${infoBox('Der Link ist <strong>1 Stunde</strong> gültig und kann nur einmal verwendet werden.', theme)}
       ${DIVIDER}
       <p style="margin:0;font-size:13px;color:#6b7280">
         Falls du keine Rücksetzung angefordert hast, kannst du diese E-Mail ignorieren.<br>
         Dein Passwort bleibt unverändert.
       </p>`,
      theme
    ),
  });
}

// ── SMTP-Verbindung testen ────────────────────────────────────────────────────
async function testSmtp() {
  const transporter = await getTransporter();
  if (!transporter) return { success: false, error: 'SMTP nicht konfiguriert (Host oder Benutzername fehlt)' };
  try {
    await transporter.verify();
    return { success: true, message: 'SMTP-Verbindung erfolgreich' };
  } catch (e) {
    return { success: false, error: fehlertext(e) };
  }
}

// emailTemplate/getMailTheme mitexportieren: Damit lässt sich das Design einer
// E-Mail prüfen, ohne eine zu versenden (test/mail-theme.test.js).
export { sendMail, sendVerificationMail, sendPasswordResetMail, testSmtp,
         emailTemplate, getMailTheme, MAIL_THEMES };
