/** RFC 6238 (TOTP, SHA-1, 6 Stellen, 30 s): die Form, die jede
 * Authenticator-App versteht. Ohne Fremdpaket, mit node:crypto. */
import { verschluessele, entschluessele, kontext, suchwert, suchwertAlt } from '../infra/geheimnis';
import crypto from 'node:crypto';
import type { DbSchnittstelle } from '../../db/database';
import * as repo from './repository/zweiterFaktor';
import type { KontoKontext } from './kontext';
import { zugangsTransaktion } from './zugangsende';

const SCHRITT_S = 30;
/** Ein Schritt vor und zurück: Uhren von Telefon und Server gehen nie gleich. */
const FENSTER = 1;
const STELLEN = 6;
const CODES_ANZAHL = 10;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const faktorKontext = (uid: number) => kontext('zweiter_faktor.geheimnis', uid);

export function base32(buf: Buffer): string {
  let bits = 0,
    wert = 0,
    aus = '';
  for (const b of buf) {
    wert = (wert << 8) | b;
    bits += 8;
    while (bits >= 5) {
      aus += BASE32[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) aus += BASE32[(wert << (5 - bits)) & 31];
  return aus;
}

export function ausBase32(s: string): Buffer {
  const rein = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0,
    wert = 0;
  const aus: number[] = [];
  for (const z of rein) {
    wert = (wert << 5) | BASE32.indexOf(z);
    bits += 5;
    if (bits >= 8) {
      aus.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(aus);
}

export function hotp(schluessel: Buffer, zaehler: number, stellen = STELLEN): string {
  const z = Buffer.alloc(8);
  z.writeBigUInt64BE(BigInt(zaehler));
  const h = crypto.createHmac('sha1', schluessel).update(z).digest();
  const o = (h[h.length - 1] ?? 0) & 15;
  const zahl = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** stellen;
  return String(zahl).padStart(stellen, '0');
}

export function zeitschritt(jetztMs = Date.now()): number {
  return Math.floor(jetztMs / 1000 / SCHRITT_S);
}

/** Vergleich in konstanter Zeit. */
export function passenderSchritt(geheimnis: string, code: string, jetztMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const schluessel = ausBase32(geheimnis);
  const jetzt = zeitschritt(jetztMs);
  let treffer: number | null = null;
  for (let s = jetzt - FENSTER; s <= jetzt + FENSTER; s++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(schluessel, s)), Buffer.from(code)) && treffer === null) treffer = s;
  }
  return treffer;
}

/** `image` zeigen manche Authenticator-Apps (etwa FreeOTP) als Logo des Eintrags; sie laden es selbst,
 * also nur mit öffentlicher Basis-URL. Authy wählt Logos nur aus eigener Sammlung. */
export function otpauthAdresse(geheimnis: string, konto: string, basis: string | null): string {
  const aussteller = 'BrickInventory';
  return (
    `otpauth://totp/${encodeURIComponent(`${aussteller}:${konto}`)}` +
    `?secret=${geheimnis}&issuer=${encodeURIComponent(aussteller)}&algorithm=SHA1&digits=${STELLEN}&period=${SCHRITT_S}` +
    (basis ? `&image=${encodeURIComponent(`${basis}/assets/logo-256.png`)}` : '')
  );
}

/** Der Link für das Konto, mit der Basis-URL dieses Satzes Dienste. */
export function otpauthFuer(k: KontoKontext, geheimnis: string, konto: string): string {
  return otpauthAdresse(geheimnis, konto, k.konfig.appBaseUrl);
}

function normiereCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}
/** HMAC mit eigenem Teilschlüssel und an das Konto gebunden: Ein Abzug der
 * Tabelle allein lässt sich nicht durchprobieren. */
const hashCode = (uid: number, code: string) => suchwert('zweiter-faktor-code', `${uid}:${normiereCode(code)}`);
/** Codes vor dem 01.11.2026: 10 Zeichen (50 Bit), ungesalzenes SHA-256. Sie gelten
 * weiter, bis sie verbraucht oder ersetzt sind: Ein Zwang zum Neuerzeugen sperrte aus, wer sie nur auf Papier hat. */
const ALT_LAENGE = 10;
const alterHash = (code: string) => crypto.createHash('sha256').update(normiereCode(code)).digest('hex');

/** 16 Zeichen Base32 = 80 Bit, in Vierergruppen zum Abschreiben. */
function neueWiederherstellungscodes(): string[] {
  return Array.from({ length: CODES_ANZAHL }, () =>
    base32(crypto.randomBytes(10)).toLowerCase().match(/.{4}/g)!.join('-'),
  );
}

async function codesErsetzen(tx: DbSchnittstelle, uid: number): Promise<string[]> {
  const codes = neueWiederherstellungscodes();
  await repo.ersetzeCodes(
    tx,
    uid,
    codes.map(c => hashCode(uid, c)),
  );
  return codes;
}

export function istAktiv(k: KontoKontext, uid: number): Promise<boolean> {
  return k.zweiterFaktor.aktiv(uid);
}

export async function stand(k: KontoKontext, uid: number): Promise<{ aktiv: boolean; codes_uebrig: number }> {
  const r = await k.zweiterFaktor.faktorStand(uid);
  return { aktiv: r.aktiv, codes_uebrig: r.uebrig };
}

/** Noch nicht aktiv. @returns null, wenn der Faktor schon aktiv ist */
export async function beginneEinrichtung(k: KontoKontext, uid: number): Promise<string | null> {
  const geheimnis = base32(crypto.randomBytes(20));
  return (await k.zweiterFaktor.legeGeheimnisAn(uid, verschluessele(geheimnis, faktorKontext(uid)))) ? geheimnis : null;
}

export async function bestaetigeEinrichtung(k: KontoKontext, uid: number, code: string): Promise<string[] | null> {
  return k.transaktion(async t => {
    const z = await repo.unbestaetigtesGeheimnisSperren(t.db, uid);
    if (!z) return null;
    const schritt = passenderSchritt(entschluessele(z.geheimnis, faktorKontext(uid)) ?? '', String(code ?? '').trim());
    if (schritt === null) return null;
    await repo.aktiviere(t.db, uid, schritt);
    return codesErsetzen(t.db, uid);
  });
}

/** Einmalcode und Wiederherstellungscode gelten genau einmal.
 * @param mitEinmalcode false (Tagesschranke): Ein sechsstelliger Code wird nicht geprüft, Raten verrät nichts. */
export async function pruefeCode(
  k: KontoKontext,
  uid: number,
  code: string | number | null | undefined,
  mitEinmalcode = true,
): Promise<'totp' | 'wiederherstellung' | null> {
  const eingabe = String(code ?? '').trim();
  if (!eingabe) return null;
  if (/^\d{6}$/.test(eingabe)) {
    if (!mitEinmalcode) return null;
    const z = await k.zweiterFaktor.aktivesGeheimnis(uid);
    const schritt = z ? passenderSchritt(entschluessele(z.geheimnis, faktorKontext(uid)) ?? '', eingabe) : null;
    if (schritt === null) return null;
    return (await k.zweiterFaktor.verbraucheSchritt(uid, schritt)) ? 'totp' : null;
  }
  if (await k.zweiterFaktor.verbraucheCode(uid, hashCode(uid, eingabe))) return 'wiederherstellung';
  // Codes aus der Zeit vor einem Schlüsselwechsel: Ihr Klartext ist nicht gespeichert, neu hashen geht nicht.
  const vorWechsel = suchwertAlt('zweiter-faktor-code', `${uid}:${normiereCode(eingabe)}`);
  if (vorWechsel && (await k.zweiterFaktor.verbraucheCode(uid, vorWechsel))) return 'wiederherstellung';
  if (normiereCode(eingabe).length !== ALT_LAENGE) return null;
  return (await k.zweiterFaktor.verbraucheCode(uid, alterHash(eingabe))) ? 'wiederherstellung' : null;
}

export function schalteAb(k: KontoKontext, uid: number): Promise<void> {
  return zugangsTransaktion(k, t => t.zweiterFaktor.entferne(uid));
}

export async function erneuereCodes(k: KontoKontext, uid: number): Promise<string[]> {
  return k.transaktion(t => codesErsetzen(t.db, uid));
}
