// Das Gerüst jeder Mail: Paletten, Kopf und Fuss, Knopf, Hinweiskasten.
// Die Texte stehen in mailer.ts, der Versand in transport.ts.

import { getGlobalSetting } from '../einstellungen/settings';
import { ausTabelle } from '../infra/validate';

/** `unknown`: Hier laufen Werte aus Datenbank und Formularen hinein. */
export function esc(s: unknown) {
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
export type MailTheme = typeof MAIL_THEMES.classic;

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
export function emailBtn(url: string, text: string, theme: MailTheme = MAIL_THEMES.classic) {
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

// Ausführlich: docs/begruendungen/src/mail/vorlage.ts.md#infobox
export function infoBox(text: string, theme: MailTheme = MAIL_THEMES.classic) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px">
    <tr>
      <td style="background:${theme.bg};border:1px solid ${theme.border};border-radius:8px;
                 padding:12px 16px;font-size:13px;color:${theme.text};font-family:Arial,Helvetica,sans-serif">
        ${text}
      </td>
    </tr>
  </table>`;
}

export const DIVIDER = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:20px 0">
  <tr><td style="height:1px;background:#e2e8f0;font-size:0;line-height:0">&nbsp;</td></tr>
</table>`;
