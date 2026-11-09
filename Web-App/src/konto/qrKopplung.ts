/** QR-Anmeldung in drei Schritten: Die Web-Sitzung erzeugt den Code, die App meldet
 * sich damit an und zeigt einen Bestätigungscode, die Web-Sitzung tippt ihn ein.
 * Erst dann holt die App ihren Token ab: Ein abfotografierter QR-Code allein
 * öffnet kein Konto, der Inhaber sieht jedes Gerät, bevor es Zugang bekommt. */
import crypto from 'node:crypto';
import * as repo from './repository/qrKopplung';
import { createToken, hashToken, ipBereich } from './auth';
import { APP_HOECHSTDAUER_TAGE, tokenLabel } from './tokenWunsch';

export type { QrStand } from './repository/qrKopplung';
export const QR_TTL_MS = 5 * 60 * 1000;
export const QR_FEHLVERSUCHE = 3;

export async function erzeuge(uid: number, tage: number | null): Promise<{ token: string; kopplung: number }> {
  await repo.raeumeQrKopplungenAuf();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const kopplung = await repo.legeQrKopplungAn(hashToken(nonce), uid, new Date(Date.now() + QR_TTL_MS), tage);
  return { token: `bim:${nonce}`, kopplung };
}

export async function meldeGeraet(
  token: unknown,
  geraet: unknown,
  ip: string | null | undefined,
): Promise<{ abholung: string; code: string; uid: number } | null> {
  if (typeof token !== 'string' || !token.startsWith('bim:')) return null;
  const abholung = crypto.randomBytes(32).toString('base64url');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const z = await repo.melde(hashToken(token.slice(4)), {
    abholung: hashToken(abholung),
    codeHash: hashToken(code),
    geraet: tokenLabel(geraet, 'Android App'),
    ipBereich: ipBereich(ip),
    fristS: QR_TTL_MS / 1000,
  });
  return z ? { abholung, code, uid: z.user_id } : null;
}

export type Abholung =
  | { stand: 'wartet' | 'abgelehnt' | 'ungueltig' }
  | { stand: 'fertig'; token: string; uid: number };

export async function holeQrTokenAb(
  abholung: unknown,
  ip: string | null | undefined,
  darf: (uid: number) => Promise<boolean>,
): Promise<Abholung> {
  const z = typeof abholung === 'string' && abholung ? await repo.nachAbholung(hashToken(abholung)) : undefined;
  if (z?.stand === 'wartet' || z?.stand === 'abgelehnt') return { stand: z.stand };
  if (z?.stand !== 'bestaetigt' || !(await darf(z.user_id)) || !(await repo.markiereAbgeholt(z.id)))
    return { stand: 'ungueltig' };
  const token = await createToken(z.user_id, z.geraet ?? 'qr-login', true, z.token_days ?? APP_HOECHSTDAUER_TAGE, {
    scope: 'app',
    ip,
  });
  return { stand: 'fertig', token, uid: z.user_id };
}

export async function kopplungsStand(kopplung: number, uid: number) {
  const z = await repo.qrKopplungDesKontos(kopplung, uid);
  return z ? { stand: z.stand, geraet: z.geraet, ip_bereich: z.ip_bereich } : null;
}

function codePasst(gespeichert: string | null, eingabe: unknown): boolean {
  const ziffern = String(eingabe ?? '').replace(/\s+/g, '');
  if (!gespeichert || !/^\d{6}$/.test(ziffern)) return false;
  return crypto.timingSafeEqual(Buffer.from(hashToken(ziffern)), Buffer.from(gespeichert));
}

export type Bestaetigung = 'ok' | 'code_falsch' | 'abgelehnt' | 'nicht_wartend' | 'unbekannt';

/** Nach QR_FEHLVERSUCHE falschen Codes ist die Kopplung abgelehnt: Sechs Ziffern hält das lange genug. */
export async function bestaetigeKopplung(kopplung: number, uid: number, code: unknown): Promise<Bestaetigung> {
  const z = await repo.qrKopplungDesKontos(kopplung, uid);
  if (!z) return 'unbekannt';
  if (z.stand !== 'wartet') return 'nicht_wartend';
  if (!codePasst(z.code_hash, code)) {
    if ((await repo.zaehleQrFehlversuch(z.id)) < QR_FEHLVERSUCHE) return 'code_falsch';
    await repo.markiereAbgelehnt(z.id);
    return 'abgelehnt';
  }
  return (await repo.markiereBestaetigt(z.id)) ? 'ok' : 'nicht_wartend';
}

export async function lehneKopplungAb(kopplung: number, uid: number): Promise<boolean> {
  const z = await repo.qrKopplungDesKontos(kopplung, uid);
  if (z) await repo.markiereAbgelehnt(z.id);
  return !!z;
}
