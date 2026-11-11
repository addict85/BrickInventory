/** QR-Anmeldung in drei Schritten: Die Web-Sitzung erzeugt den Code, die App meldet
 * sich damit an und zeigt einen Bestätigungscode, die Web-Sitzung tippt ihn ein.
 * Erst dann holt die App ihren Token ab: Ein abfotografierter QR-Code allein
 * öffnet kein Konto, der Inhaber sieht jedes Gerät, bevor es Zugang bekommt. */
import crypto from 'node:crypto';
import { createToken, hashToken, ipBereich } from './geraeteToken';
import { APP_HOECHSTDAUER_TAGE, tokenLabel } from './tokenWunsch';
import { fachfehler } from '../infra/fehlerTexte';
import { neueNonce } from './geraeteChallenge';
import { kontoBereich } from './prozess';

export type { QrStand } from './repository/qrKopplung';
export const QR_TTL_MS = 5 * 60 * 1000;
export const QR_FEHLVERSUCHE = 3;

/** Über alle Konten: Jede offene Kopplung ist ein Ziel für das öffentliche /qr-login. */
export const OFFENE_KOPPLUNGEN_HOECHSTENS = 500;

export async function erzeuge(uid: number, tage: number | null): Promise<{ token: string; kopplung: number }> {
  await kontoBereich().qrKopplung.raeumeQrKopplungenAuf();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const bis = new Date(Date.now() + QR_TTL_MS);
  const kopplung = await kontoBereich().qrKopplung.legeQrKopplungAn(
    hashToken(nonce),
    uid,
    bis,
    tage,
    OFFENE_KOPPLUNGEN_HOECHSTENS,
  );
  if (kopplung === null) fachfehler('nicht_verfuegbar', 'server_ausgelastet');
  return { token: `bim:${nonce}`, kopplung };
}

export async function meldeGeraet(
  token: string | null | undefined,
  geraet: unknown,
  ip: string | null | undefined,
): Promise<{ abholung: string; code: string; uid: number } | null> {
  if (typeof token !== 'string' || !token.startsWith('bim:')) return null;
  const abholung = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const z = await kontoBereich().qrKopplung.melde(hashToken(token.slice(4)), {
    abholung: hashToken(abholung),
    codeHash: hashToken(code),
    geraet: tokenLabel(geraet, 'Android App'),
    ipBereich: ipBereich(ip),
    fristS: QR_TTL_MS / 1000,
  });
  return z ? { abholung, code, uid: z.user_id } : null;
}

export type Abholung =
  | { stand: 'wartet' }
  | { stand: 'abgelehnt' }
  | { stand: 'ungueltig' }
  | { stand: 'bereit'; uid: number }
  | { stand: 'fertig'; token: string; uid: number; schluesselNonce: string | null };

const zeileZur = (abholung: string | null | undefined) =>
  typeof abholung === 'string' && abholung
    ? kontoBereich().qrKopplung.nachAbholung(hashToken(abholung))
    : Promise.resolve(undefined);

/** Mit [vorschau] nur das Konto: Die App zeigt es und holt den Token erst nach dem Ja.
 * Die Nonce für den Geräteschlüssel entsteht mit dem Token und gilt nur seiner Familie. */
export async function holeQrTokenAb(
  abholung: string | null | undefined,
  ip: string | null | undefined,
  darf: (uid: number) => Promise<boolean>,
  vorschau = false,
): Promise<Abholung> {
  const z = await zeileZur(abholung);
  if (z?.stand === 'wartet') return { stand: 'wartet' };
  if (z?.stand === 'abgelehnt') return { stand: 'abgelehnt' };
  if (z?.stand !== 'bestaetigt' || !(await darf(z.user_id))) return { stand: 'ungueltig' };
  if (vorschau) return { stand: 'bereit', uid: z.user_id };
  if (!(await kontoBereich().qrKopplung.markiereAbgeholt(z.id))) return { stand: 'ungueltig' };
  const token = await createToken(z.user_id, z.geraet ?? 'qr-login', true, z.token_days ?? APP_HOECHSTDAUER_TAGE, {
    scope: 'app',
    ip,
  });
  const familie = await kontoBereich().geraeteSchluessel.familieDesTokens(hashToken(token));
  const schluesselNonce = familie ? await neueNonce(familie, true) : null;
  return { stand: 'fertig', token, uid: z.user_id, schluesselNonce };
}

/** Das Nein der App nach der Vorschau: Die Kopplung ist danach abgelehnt, ein Token entsteht nie. */
export async function verwirfAbholung(abholung: string | null | undefined): Promise<boolean> {
  const z = await zeileZur(abholung);
  if (z?.stand !== 'bestaetigt' && z?.stand !== 'wartet') return false;
  await kontoBereich().qrKopplung.markiereAbgelehnt(z.id);
  return true;
}

export async function kopplungsStand(kopplung: number, uid: number) {
  const z = await kontoBereich().qrKopplung.qrKopplungDesKontos(kopplung, uid);
  return z ? { stand: z.stand, geraet: z.geraet, ip_bereich: z.ip_bereich } : null;
}

function codePasst(gespeichert: string | null, eingabe: string | number | null | undefined): boolean {
  const ziffern = String(eingabe ?? '').replace(/\s+/g, '');
  if (!gespeichert || !/^\d{6}$/.test(ziffern)) return false;
  return crypto.timingSafeEqual(Buffer.from(hashToken(ziffern)), Buffer.from(gespeichert));
}

export type Bestaetigung = 'ok' | 'code_falsch' | 'abgelehnt' | 'nicht_wartend' | 'unbekannt';

/** Nach QR_FEHLVERSUCHE falschen Codes ist die Kopplung abgelehnt: Sechs Ziffern hält das lange genug. */
export async function bestaetigeKopplung(
  kopplung: number,
  uid: number,
  code: string | number | null | undefined,
): Promise<Bestaetigung> {
  const z = await kontoBereich().qrKopplung.qrKopplungDesKontos(kopplung, uid);
  if (!z) return 'unbekannt';
  if (z.stand !== 'wartet') return 'nicht_wartend';
  if (!codePasst(z.code_hash, code)) {
    if ((await kontoBereich().qrKopplung.zaehleQrFehlversuch(z.id)) < QR_FEHLVERSUCHE) return 'code_falsch';
    await kontoBereich().qrKopplung.markiereAbgelehnt(z.id);
    return 'abgelehnt';
  }
  return (await kontoBereich().qrKopplung.markiereBestaetigt(z.id)) ? 'ok' : 'nicht_wartend';
}

export async function lehneKopplungAb(kopplung: number, uid: number): Promise<boolean> {
  const z = await kontoBereich().qrKopplung.qrKopplungDesKontos(kopplung, uid);
  if (z) await kontoBereich().qrKopplung.markiereAbgelehnt(z.id);
  return !!z;
}
