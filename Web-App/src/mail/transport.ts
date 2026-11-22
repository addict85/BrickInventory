// Sending: SMTP connection, sender address, console output without a mail server.
// Skeleton and texts of the mails: template.ts and mailer.ts.

import nodemailer from 'nodemailer';
import tls from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import type { MailContext } from './context';
import addressparser from 'nodemailer/lib/addressparser';
import { emailValid } from '../infra/validate';
import { fehlertext } from '../infra/error';
import { resolveOn, mailServerAddress } from '../infra/targetAddress';
const setting = (k: MailContext, key: string) => k.einstellungen.globalValue(key, '');

function normalizeFingerprint(value: unknown): string {
  return String(value ?? '')
    .replace(/[\s:]/g, '')
    .toUpperCase();
}

/** Verification stays on: a self-signed certificate comes in as PEM; a
 * fingerprint pins exactly one and replaces the hostname check. */
async function getTransporter(k: MailContext) {
  const host = await setting(k, 'smtp_host');
  const port = parseInt((await setting(k, 'smtp_port')) || '587', 10);
  const user = await setting(k, 'smtp_user');
  const pass = await setting(k, 'smtp_pass');
  const secure = (await setting(k, 'smtp_secure')) === '1';
  const ca = (await setting(k, 'smtp_tls_ca')).trim();
  const fp = normalizeFingerprint(await setting(k, 'smtp_tls_fingerprint'));
  if (!host || !user) return null;
  // Resolved and checked here, then connected to exactly this address; the name stays for SNI and the certificate.
  const address = await resolveOn(host, ip => mailServerAddress(ip));
  const checkPeer = (name: string, cert: PeerCertificate) => {
    if (!fp) return tls.checkServerIdentity(name, cert);
    if (normalizeFingerprint(cert.fingerprint256) === fp) return undefined;
    return Object.assign(new Error(`Fingerabdruck ${cert.fingerprint256} ist nicht der eingetragene`), {
      code: 'SMTP_FINGERABDRUCK',
    });
  };
  // requireTLS: without STARTTLS in the EHLO reply nodemailer would otherwise fall back
  // to plain text and send password and reset links readable across the network.
  return nodemailer.createTransport({
    host: address,
    ...(address !== host ? { servername: host } : {}),
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      checkServerIdentity: checkPeer,
      ...(ca ? { ca } : {}),
    },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
}

const CERTIFICATE_ERRORS = new Set([
  'SMTP_FINGERABDRUCK',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** A certificate error tells the administrator what to enter, instead of just the code. */
function smtpErrorText(e: unknown): { text: string; certificate: boolean } {
  const code = String((e as { code?: unknown; cause?: { code?: unknown } })?.code ?? '');
  const cause = String((e as { cause?: { code?: unknown } })?.cause?.code ?? '');
  const certificate =
    CERTIFICATE_ERRORS.has(code) || CERTIFICATE_ERRORS.has(cause) || /certificate|Fingerabdruck/i.test(fehlertext(e));
  const noStarttls = code === 'ETLS' && /upgrading connection with STARTTLS/.test(fehlertext(e));
  return {
    certificate,
    text: certificate
      ? `Zertifikat des Mailservers nicht bestätigt (${fehlertext(e)}). Unter Menü → Einstellungen → E-Mail das Zertifikat (PEM) oder seinen SHA-256-Fingerabdruck eintragen.`
      : noStarttls
        ? 'Der Mailserver bietet kein STARTTLS an; unverschlüsselt wird nichts gesendet. Port 465 mit „SSL/TLS" wählen oder STARTTLS am Mailserver einschalten.'
        : fehlertext(e),
  };
}

/** Whoever had set the dropped exception "do not verify certificate" learns about it at startup. */
export async function reportSmtpLegacySetting(k: MailContext): Promise<boolean> {
  if ((await setting(k, 'smtp_insecure_tls')) !== '1') return false;
  console.warn(
    '⚠️  [mailer] smtp_insecure_tls wird nicht mehr ausgewertet: Das Zertifikat des Mailservers wird jetzt geprüft. ' +
      'Für ein selbst signiertes Zertifikat unter Menü → Einstellungen → E-Mail das Zertifikat (PEM) oder den SHA-256-Fingerabdruck eintragen.',
  );
  return true;
}

async function getFrom(k: MailContext) {
  return (await setting(k, 'smtp_from')) || 'BrickInventory Manager <noreply@brickinventory.local>';
}

/** No token unless MAIL_KONSOLE_MIT_TOKEN=1: the console ends up in
 * app_logs, and a reset link grants access to the account. NODE_ENV is not good
 * enough — "development" is quickly set on a real server. The link comes from
 * the sender, not from the text: there, an input could slip in a foreign URL. */
export function linkForConsole(link: string | undefined, flag: string | undefined): string | null {
  const url = link && /^https?:\/\/\S+$/.test(link) ? link : null;
  if (!url) return null;
  return flag === '1' ? url : url.replace(/([?&#]token=)[^&#\s]+/g, '$1…');
}

/** The console ends up in app_logs, which every administrator reads; in full only with the developer flag, like the links. */
export function maskAddress(address: string, full: boolean): string {
  if (full) return address;
  const at = address.lastIndexOf('@');
  return at < 1 ? '…' : `${address[0]}…${address.slice(at)}`;
}

/** For nodemailer the string must be exactly this one address, otherwise the
 * mail would go to a different one than the checked one (display name, list). */
export function isSingleRecipient(to: string): boolean {
  const list = emailValid(to) ? addressparser(to, { flatten: true }) : [];
  return list.length === 1 && list[0]!.address === to && !list[0]!.name;
}

/** Without SMTP to the console; `html` and `text` optional because the console
 * only reads `text`. */
export async function sendMail(
  k: MailContext,
  {
    to,
    subject,
    html,
    text,
    link: realLink,
  }: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    link?: string;
  },
) {
  if (!isSingleRecipient(to)) {
    console.warn(
      `📧 Empfänger abgelehnt (${maskAddress(to, k.konfig.mailConsoleWithToken)}): keine einzelne reine Adresse`,
    );
    return { success: false, error: 'empfaenger_ungueltig', mode: 'smtp' };
  }
  let transporter: Awaited<ReturnType<typeof getTransporter>>;
  try {
    transporter = await getTransporter(k);
  } catch (e) {
    // Exception: the response carries the failure (success: false); smtpErrorText gives the text without credentials.
    console.error(`📧 SMTP Fehler (${maskAddress(to, k.konfig.mailConsoleWithToken)}):`, smtpErrorText(e).text);
    return { success: false, error: smtpErrorText(e).text, mode: 'smtp' };
  }
  const from = await getFrom(k);
  if (!transporter) {
    const link = linkForConsole(realLink, k.konfig.mailConsoleWithToken ? '1' : undefined);
    console.log('\n══════════════════════════════════════════════════');
    console.log('📧  E-Mail (SMTP nicht konfiguriert):');
    console.log(`    An:      ${maskAddress(to, k.konfig.mailConsoleWithToken)}`);
    console.log(`    Betreff: ${subject}`);
    if (link) console.log(`    Link:    ${link}`);
    console.log('══════════════════════════════════════════════════\n');
    return { success: true, mode: 'console' };
  }
  try {
    const sender = addressparser(from, { flatten: true })[0]?.address;
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      ...(sender ? { envelope: { from: sender, to: [to] } } : {}),
    });
    console.log(`📧 E-Mail gesendet an ${maskAddress(to, k.konfig.mailConsoleWithToken)}: ${info.messageId}`);
    return { success: true, mode: 'smtp', messageId: info.messageId };
  } catch (e) {
    const { text } = smtpErrorText(e);
    console.error(`📧 SMTP Fehler (${maskAddress(to, k.konfig.mailConsoleWithToken)}):`, text);
    return { success: false, error: text, mode: 'smtp' };
  }
}

export async function testSmtp(k: MailContext) {
  try {
    const transporter = await getTransporter(k);
    // A code instead of a sentence: testSmtp() does not know who is asking.
    if (!transporter) return { success: false as const, code: 'smtp_nicht_konfiguriert' as const };
    await transporter.verify();
    return { success: true as const, message: 'SMTP-Verbindung erfolgreich' };
  } catch (e) {
    const { text, certificate } = smtpErrorText(e);
    return certificate
      ? { success: false as const, code: 'smtp_zertifikat' as const, vars: { grund: fehlertext(e) } }
      : { success: false as const, code: 'smtp_fehler' as const, vars: { grund: text } };
  }
}
