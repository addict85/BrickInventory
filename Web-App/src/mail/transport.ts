// Der Versand: SMTP-Verbindung, Absender, Konsolenausgabe ohne Mailserver.
// Gerüst und Texte der Mails: vorlage.ts und mailer.ts.

import nodemailer from 'nodemailer';
import tls from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import { konfig } from '../infra/konfig';
import { getGlobalSetting } from '../einstellungen';
import addressparser from 'nodemailer/lib/addressparser';
import { emailGueltig } from '../infra/validate';
import { fehlertext } from '../infra/fehler';
import { loeseAuf, mailserverAdresse } from '../infra/zielAdresse';
const getSetting = (key: string) => getGlobalSetting(key, '');

function normiereFingerabdruck(wert: unknown): string {
  return String(wert ?? '')
    .replace(/[\s:]/g, '')
    .toUpperCase();
}

/** Die Prüfung bleibt an: Ein selbst signiertes Zertifikat kommt als PEM herein; ein
 * Fingerabdruck nagelt genau eines fest und ersetzt den Abgleich des Hostnamens. */
async function getTransporter() {
  const host = await getSetting('smtp_host');
  const port = parseInt((await getSetting('smtp_port')) || '587');
  const user = await getSetting('smtp_user');
  const pass = await getSetting('smtp_pass');
  const secure = (await getSetting('smtp_secure')) === '1';
  const ca = (await getSetting('smtp_tls_ca')).trim();
  const fp = normiereFingerabdruck(await getSetting('smtp_tls_fingerprint'));
  if (!host || !user) return null;
  // Aufgelöst und geprüft wird hier, verbunden mit genau dieser Adresse; der Name bleibt für SNI und Zertifikat.
  const adresse = await loeseAuf(host, ip => mailserverAdresse(ip));
  const pruefeGegenstelle = (name: string, zert: PeerCertificate) => {
    if (!fp) return tls.checkServerIdentity(name, zert);
    if (normiereFingerabdruck(zert.fingerprint256) === fp) return undefined;
    return Object.assign(new Error(`Fingerabdruck ${zert.fingerprint256} ist nicht der eingetragene`), {
      code: 'SMTP_FINGERABDRUCK',
    });
  };
  // requireTLS: Ohne STARTTLS in der EHLO-Antwort fiele nodemailer sonst auf
  // Klartext zurück und schickte Passwort und Rücksetzlinks lesbar durchs Netz.
  return nodemailer.createTransport({
    host: adresse,
    ...(adresse !== host ? { servername: host } : {}),
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      checkServerIdentity: pruefeGegenstelle,
      ...(ca ? { ca } : {}),
    },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
}

const ZERTIFIKATSFEHLER = new Set([
  'SMTP_FINGERABDRUCK',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Ein Zertifikatsfehler sagt dem Verwalter, was er eintragen muss, statt nur den Code. */
function smtpFehlertext(e: unknown): { text: string; zertifikat: boolean } {
  const code = String((e as { code?: unknown; cause?: { code?: unknown } })?.code ?? '');
  const ursache = String((e as { cause?: { code?: unknown } })?.cause?.code ?? '');
  const zertifikat =
    ZERTIFIKATSFEHLER.has(code) || ZERTIFIKATSFEHLER.has(ursache) || /certificate|Fingerabdruck/i.test(fehlertext(e));
  const ohneStarttls = code === 'ETLS' && /upgrading connection with STARTTLS/.test(fehlertext(e));
  return {
    zertifikat,
    text: zertifikat
      ? `Zertifikat des Mailservers nicht bestätigt (${fehlertext(e)}). Unter Menü → Einstellungen → E-Mail das Zertifikat (PEM) oder seinen SHA-256-Fingerabdruck eintragen.`
      : ohneStarttls
        ? 'Der Mailserver bietet kein STARTTLS an; unverschlüsselt wird nichts gesendet. Port 465 mit „SSL/TLS" wählen oder STARTTLS am Mailserver einschalten.'
        : fehlertext(e),
  };
}

/** Wer die entfallene Ausnahme „Zertifikat nicht prüfen" gesetzt hatte, erfährt es beim Start. */
export async function meldeSmtpAltlast(): Promise<boolean> {
  if ((await getSetting('smtp_insecure_tls')) !== '1') return false;
  console.warn(
    '⚠️  [mailer] smtp_insecure_tls wird nicht mehr ausgewertet: Das Zertifikat des Mailservers wird jetzt geprüft. ' +
      'Für ein selbst signiertes Zertifikat unter Menü → Einstellungen → E-Mail das Zertifikat (PEM) oder den SHA-256-Fingerabdruck eintragen.',
  );
  return true;
}

async function getFrom() {
  return (await getSetting('smtp_from')) || 'BrickInventory Manager <noreply@brickinventory.local>';
}

/** Ohne Token, ausser mit MAIL_KONSOLE_MIT_TOKEN=1: Die Konsole landet in
 * app_logs, und ein Reset-Link ist ein Zugang zum Konto. NODE_ENV taugt dafür
 * nicht — „development" steht schnell auf einem echten Server. Der Link kommt
 * vom Absender, nicht aus dem Text: Dort kann eine Eingabe eine fremde URL vorschieben. */
export function linkFuerKonsole(
  link?: string,
  schalter = konfig().mailKonsoleMitToken ? '1' : undefined,
): string | null {
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
export async function sendMail({
  to,
  subject,
  html,
  text,
  link: echterLink,
}: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  link?: string;
}) {
  if (!einzigerEmpfaenger(to)) {
    console.warn(`📧 Empfänger abgelehnt (${maskiereAdresse(to)}): keine einzelne reine Adresse`);
    return { success: false, error: 'empfaenger_ungueltig', mode: 'smtp' };
  }
  let transporter: Awaited<ReturnType<typeof getTransporter>>;
  try {
    transporter = await getTransporter();
  } catch (e) {
    console.error(`📧 SMTP Fehler (${maskiereAdresse(to)}):`, smtpFehlertext(e).text);
    return { success: false, error: smtpFehlertext(e).text, mode: 'smtp' };
  }
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
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      ...(absender ? { envelope: { from: absender, to: [to] } } : {}),
    });
    console.log(`📧 E-Mail gesendet an ${maskiereAdresse(to)}: ${info.messageId}`);
    return { success: true, mode: 'smtp', messageId: info.messageId };
  } catch (e) {
    const { text } = smtpFehlertext(e);
    console.error(`📧 SMTP Fehler (${maskiereAdresse(to)}):`, text);
    return { success: false, error: text, mode: 'smtp' };
  }
}

export async function testSmtp() {
  try {
    const transporter = await getTransporter();
    // Code statt Satz: testSmtp() kennt den Anfragenden nicht.
    if (!transporter) return { success: false as const, code: 'smtp_nicht_konfiguriert' as const };
    await transporter.verify();
    return { success: true as const, message: 'SMTP-Verbindung erfolgreich' };
  } catch (e) {
    const { text, zertifikat } = smtpFehlertext(e);
    return zertifikat
      ? { success: false as const, code: 'smtp_zertifikat' as const, vars: { grund: fehlertext(e) } }
      : { success: false as const, code: 'smtp_fehler' as const, vars: { grund: text } };
  }
}
