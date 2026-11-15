/** QR-Anmeldung in drei Schritten: Die Web-Sitzung erzeugt den Code, die App meldet
 * sich damit an und zeigt einen Bestätigungscode, die Web-Sitzung tippt ihn ein.
 * Erst dann holt die App ihren Token ab: Ein abfotografierter QR-Code allein
 * öffnet kein Konto, der Inhaber sieht jedes Gerät, bevor es Zugang bekommt. */
import crypto from 'node:crypto';
import { tokenAnlegen, tokenAbdruck, ipBereich } from './geraeteToken';
import { APP_HOECHSTDAUER_TAGE, tokenLabel } from './tokenWunsch';
import { fachfehler } from '../infra/fehlerTexte';
import type { KontoKontext } from './kontext';

export type { QrStand } from './repository/qrKopplung';
export const QR_TTL_MS = 5 * 60 * 1000;
export const QR_FEHLVERSUCHE = 3;

/** Über alle Konten: Jede offene Kopplung ist ein Ziel für das öffentliche /qr-login. */
export const OFFENE_KOPPLUNGEN_HOECHSTENS = 500;

export async function erzeuge(
  k: KontoKontext,
  uid: number,
  tage: number | null,
): Promise<{ token: string; kopplung: number }> {
  await k.qrKopplung.raeumeQrKopplungenAuf();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const bis = new Date(k.uhr.jetzt() + QR_TTL_MS);
  const kopplung = await k.qrKopplung.legeQrKopplungAn(
    tokenAbdruck(nonce),
    uid,
    bis,
    tage,
    OFFENE_KOPPLUNGEN_HOECHSTENS,
  );
  if (kopplung === null) fachfehler('nicht_verfuegbar', 'server_ausgelastet');
  return { token: `bim:${nonce}`, kopplung };
}

export async function meldeGeraet(
  k: KontoKontext,
  token: string | null | undefined,
  geraet: unknown,
  ip: string | null | undefined,
): Promise<{ abholung: string; code: string; uid: number } | null> {
  if (typeof token !== 'string' || !token.startsWith('bim:')) return null;
  const abholung = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const z = await k.qrKopplung.melde(tokenAbdruck(token.slice(4)), {
    abholung: tokenAbdruck(abholung),
    codeHash: tokenAbdruck(code),
    geraet: tokenLabel(geraet, 'Android App'),
    ipBereich: ipBereich(ip),
    fristS: QR_TTL_MS / 1000,
  });
  return z ? { abholung, code, uid: z.user_id } : null;
}

export type Abholung =
  | { stand: 'wartet' }
  | { stand: 'bereit'; uid: number }
  | { stand: 'fertig'; token: string; uid: number; schluesselNonce: string | null };

const zeileZur = (k: KontoKontext, abholung: string | null | undefined) =>
  typeof abholung === 'string' && abholung
    ? k.qrKopplung.nachAbholung(tokenAbdruck(abholung))
    : Promise.resolve(undefined);

/** Mit [vorschau] nur das Konto: Die App zeigt es und holt den Token erst nach dem Ja.
 * Die Nonce für den Geräteschlüssel entsteht mit dem Token und gilt nur seiner Familie. */
export async function holeQrTokenAb(
  k: KontoKontext,
  abholung: string | null | undefined,
  ip: string | null | undefined,
  darf: (uid: number) => Promise<boolean>,
  vorschau = false,
): Promise<Abholung> {
  const z = await zeileZur(k, abholung);
  if (z?.stand === 'wartet') return { stand: 'wartet' };
  if (z?.stand === 'abgelehnt') fachfehler('verboten', 'qr_abgelehnt');
  if (z?.stand !== 'bestaetigt' || !(await darf(z.user_id))) fachfehler('nicht_angemeldet', 'token_ungueltig');
  if (vorschau) return { stand: 'bereit', uid: z.user_id };
  if (!(await k.qrKopplung.markiereAbgeholt(z.id))) fachfehler('nicht_angemeldet', 'token_ungueltig');
  const token = await tokenAnlegen(k, z.user_id, z.geraet ?? 'qr-login', true, z.token_days ?? APP_HOECHSTDAUER_TAGE, {
    scope: 'app',
    ip,
  });
  const familie = await k.geraete.familieDesTokens(tokenAbdruck(token));
  const schluesselNonce = familie ? await k.geraete.neueNonce(familie, true) : null;
  return { stand: 'fertig', token, uid: z.user_id, schluesselNonce };
}

/** Das Nein der App nach der Vorschau: Die Kopplung ist danach abgelehnt, ein Token entsteht nie. */
export async function verwirfAbholung(k: KontoKontext, abholung: string | null | undefined): Promise<boolean> {
  const z = await zeileZur(k, abholung);
  if (z?.stand !== 'bestaetigt' && z?.stand !== 'wartet') return false;
  await k.qrKopplung.markiereAbgelehnt(z.id);
  return true;
}

export async function kopplungsStand(k: KontoKontext, kopplung: number, uid: number) {
  const z = await k.qrKopplung.qrKopplungDesKontos(kopplung, uid);
  return z ? { stand: z.stand, geraet: z.geraet, ip_bereich: z.ip_bereich } : null;
}

function codePasst(gespeichert: string | null, eingabe: string | number | null | undefined): boolean {
  const ziffern = String(eingabe ?? '').replace(/\s+/g, '');
  if (!gespeichert || !/^\d{6}$/.test(ziffern)) return false;
  return crypto.timingSafeEqual(Buffer.from(tokenAbdruck(ziffern)), Buffer.from(gespeichert));
}

/** Nach QR_FEHLVERSUCHE falschen Codes ist die Kopplung abgelehnt: Sechs Ziffern hält das lange genug. */
export async function bestaetigeKopplung(
  k: KontoKontext,
  kopplung: number,
  uid: number,
  code: string | number | null | undefined,
): Promise<void> {
  const z = await k.qrKopplung.qrKopplungDesKontos(kopplung, uid);
  if (!z) fachfehler('nicht_gefunden', 'nicht_gefunden');
  if (z.stand !== 'wartet') fachfehler('konflikt', 'qr_nicht_wartend');
  if (!codePasst(z.code_hash, code)) {
    if ((await k.qrKopplung.zaehleQrFehlversuch(z.id)) < QR_FEHLVERSUCHE) fachfehler('ungueltig', 'qr_code_falsch');
    await k.qrKopplung.markiereAbgelehnt(z.id);
    fachfehler('verboten', 'qr_abgelehnt');
  }
  if (!(await k.qrKopplung.markiereBestaetigt(z.id))) fachfehler('konflikt', 'qr_nicht_wartend');
}

export async function lehneKopplungAb(k: KontoKontext, kopplung: number, uid: number): Promise<boolean> {
  const z = await k.qrKopplung.qrKopplungDesKontos(kopplung, uid);
  if (z) await k.qrKopplung.markiereAbgelehnt(z.id);
  return !!z;
}
