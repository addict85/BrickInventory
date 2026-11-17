/** RFC 6238 (TOTP, SHA-1, 6 Stellen, 30 s): die Form, die jede
 * Authenticator-App versteht. Ohne Fremdpaket, mit node:crypto. */
import { verschluessele, entschluessele, kontext, suchwert, suchwertAlt } from '../infra/geheimnis';
import crypto from 'node:crypto';
import type { DbSchnittstelle } from '../../db/database';
import * as repo from './repository/zweiterFaktor';
import type { FaktorenKontext } from './kontext';
import { imSystemrahmen } from '../infra/bereich';

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
export function passenderSchritt(geheimnis: string, code: string, jetztMs: number): number | null {
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
export function otpauthFuer(k: FaktorenKontext, geheimnis: string, konto: string): string {
  return otpauthAdresse(geheimnis, konto, k.konfig.appBaseUrl);
}

function normiereCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}
/** HMAC mit eigenem Teilschlüssel und an das Konto gebunden: Ein Abzug der
 * Tabelle allein lässt sich nicht durchprobieren. */
const hashCode = (uid: number, code: string) => suchwert('zweiter-faktor-code', `${uid}:${normiereCode(code)}`);
/** Codes vor dem 01.11.2026: 10 Zeichen (50 Bit), ungesalzenes SHA-256. Sie gelten noch 90 Tage
 * ab dem Update (0122), nicht sofort nicht mehr: Wer sie nur auf Papier hat, soll Zeit zum Ersetzen haben. */
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

export function istAktiv(k: FaktorenKontext, uid: number): Promise<boolean> {
  return k.zweiterFaktor.aktiv(uid);
}

/** `alte_codes_bis`: Offene Codes könnten alter Art sein und gelten dann nur bis dahin. */
export async function stand(
  k: FaktorenKontext,
  uid: number,
): Promise<{ aktiv: boolean; codes_uebrig: number; alte_codes_bis: string | null }> {
  const r = await k.zweiterFaktor.faktorStand(uid);
  return { aktiv: r.aktiv, codes_uebrig: r.uebrig, alte_codes_bis: r.altBis ? r.altBis.toISOString() : null };
}

/** Noch nicht aktiv. @returns null, wenn der Faktor schon aktiv ist */
export async function beginneEinrichtung(k: FaktorenKontext, uid: number): Promise<string | null> {
  const geheimnis = base32(crypto.randomBytes(20));
  return (await k.zweiterFaktor.legeGeheimnisAn(uid, verschluessele(geheimnis, faktorKontext(uid)))) ? geheimnis : null;
}

export async function bestaetigeEinrichtung(k: FaktorenKontext, uid: number, code: string): Promise<string[] | null> {
  return k.transaktion(async t => {
    const z = await repo.unbestaetigtesGeheimnisSperren(t.db, uid);
    if (!z) return null;
    const schritt = passenderSchritt(
      entschluessele(z.geheimnis, faktorKontext(uid)) ?? '',
      String(code ?? '').trim(),
      t.uhr.jetzt(),
    );
    if (schritt === null) return null;
    await repo.aktiviere(t.db, uid, schritt);
    return codesErsetzen(t.db, uid);
  });
}

/** Einmalcode und Wiederherstellungscode gelten genau einmal.
 * @param mitEinmalcode false (Tagesschranke): Ein sechsstelliger Code wird nicht geprüft, Raten verrät nichts. */
export async function pruefeCode(
  k: FaktorenKontext,
  uid: number,
  code: string | number | null | undefined,
  mitEinmalcode = true,
): Promise<'totp' | 'wiederherstellung' | 'wiederherstellung_alt' | null> {
  const eingabe = String(code ?? '').trim();
  if (!eingabe) return null;
  if (/^\d{6}$/.test(eingabe)) {
    if (!mitEinmalcode) return null;
    const z = await k.zweiterFaktor.aktivesGeheimnis(uid);
    const schritt = z
      ? passenderSchritt(entschluessele(z.geheimnis, faktorKontext(uid)) ?? '', eingabe, k.uhr.jetzt())
      : null;
    if (schritt === null) return null;
    return (await k.zweiterFaktor.verbraucheSchritt(uid, schritt)) ? 'totp' : null;
  }
  // Codes aus der Zeit vor einem Schlüsselwechsel: Ihr Klartext ist nicht gespeichert, neu hashen geht nicht.
  const vorWechsel = suchwertAlt('zweiter-faktor-code', `${uid}:${normiereCode(eingabe)}`);
  if (
    (await k.zweiterFaktor.verbraucheCode(uid, hashCode(uid, eingabe))) ||
    (vorWechsel && (await k.zweiterFaktor.verbraucheCode(uid, vorWechsel)))
  ) {
    await k.zweiterFaktor.codesSindNeu(uid);
    return 'wiederherstellung';
  }
  if (normiereCode(eingabe).length !== ALT_LAENGE) return null;
  return (await k.zweiterFaktor.verbraucheCode(uid, alterHash(eingabe), true)) ? 'wiederherstellung_alt' : null;
}

export function schalteAb(k: FaktorenKontext, uid: number): Promise<void> {
  return imSystemrahmen(k.db, 'zugangsdaten', () => k.transaktion(t => t.zweiterFaktor.entferne(uid)));
}

export async function erneuereCodes(k: FaktorenKontext, uid: number): Promise<string[]> {
  return k.transaktion(t => codesErsetzen(t.db, uid));
}

/** Für die Kontenliste der Verwaltung: Die Konten liegen beim Konto, ihr Faktor hier. */
export function aktiveUnter(k: FaktorenKontext, ids: number[]): Promise<Set<number>> {
  return k.zweiterFaktor.mitAktivemFaktor(ids);
}
