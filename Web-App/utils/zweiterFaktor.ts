/**
 * Zweiter Faktor: Einmalcodes nach RFC 6238 (TOTP, SHA-1, 6 Stellen, 30 s) —
 * die Form, die jede Authenticator-App versteht. Ohne Fremdpaket, mit
 * node:crypto. Freiwillig je Konto; Tabellen in Migration 0042.
 */
import crypto from 'crypto';
const db = require('../db/database') as typeof import('../db/database');

const SCHRITT_S = 30;
/** Ein Schritt vor und zurück: Uhren von Telefon und Server gehen nie gleich. */
const FENSTER = 1;
const STELLEN = 6;
const CODES_ANZAHL = 10;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0, wert = 0, aus = '';
  for (const b of buf) {
    wert = (wert << 8) | b; bits += 8;
    while (bits >= 5) { aus += BASE32[(wert >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) aus += BASE32[(wert << (5 - bits)) & 31];
  return aus;
}

export function ausBase32(s: string): Buffer {
  const rein = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, wert = 0;
  const aus: number[] = [];
  for (const z of rein) {
    wert = (wert << 5) | BASE32.indexOf(z); bits += 5;
    if (bits >= 8) { aus.push((wert >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(aus);
}

/** HOTP (RFC 4226) — TOTP ist HOTP mit der Zeit als Zähler. */
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

/** Der Zeitschritt, zu dem der Code passt — oder null. Vergleich in konstanter Zeit. */
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

export function otpauthAdresse(geheimnis: string, konto: string): string {
  const aussteller = 'BrickInventory';
  return `otpauth://totp/${encodeURIComponent(`${aussteller}:${konto}`)}` +
    `?secret=${geheimnis}&issuer=${encodeURIComponent(aussteller)}&algorithm=SHA1&digits=${STELLEN}&period=${SCHRITT_S}`;
}

/** Eingaben wie „ab12c-de34f" oder „AB12CDE34F" auf eine Form bringen. */
function normiereCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}
const hashCode = (code: string) => crypto.createHash('sha256').update(normiereCode(code)).digest('hex');

function neueWiederherstellungscodes(): string[] {
  return Array.from({ length: CODES_ANZAHL }, () => {
    const roh = base32(crypto.randomBytes(7)).slice(0, 10).toLowerCase();
    return `${roh.slice(0, 5)}-${roh.slice(5)}`;
  });
}

async function codesErsetzen(tx: import('../db/database').DbSchnittstelle, uid: number): Promise<string[]> {
  const codes = neueWiederherstellungscodes();
  await tx.run('DELETE FROM zweiter_faktor_codes WHERE user_id = $1', [uid]);
  for (const c of codes)
    await tx.run('INSERT INTO zweiter_faktor_codes (user_id, code_hash) VALUES ($1, $2)', [uid, hashCode(c)]);
  return codes;
}

export async function istAktiv(uid: number): Promise<boolean> {
  const r = await db.get('SELECT aktiv FROM zweiter_faktor WHERE user_id = $1', [uid]);
  return r?.aktiv === true;
}

export async function stand(uid: number): Promise<{ aktiv: boolean; codes_uebrig: number }> {
  const r = await db.get(
    `SELECT COALESCE((SELECT aktiv FROM zweiter_faktor WHERE user_id = $1), FALSE) AS aktiv,
            (SELECT COUNT(*)::int FROM zweiter_faktor_codes WHERE user_id = $1 AND verbraucht_am IS NULL) AS uebrig`, [uid]);
  return { aktiv: r?.aktiv === true, codes_uebrig: Number(r?.uebrig ?? 0) };
}

/** Neues Geheimnis anlegen (noch nicht aktiv). @returns null, wenn der Faktor schon aktiv ist */
export async function beginneEinrichtung(uid: number): Promise<string | null> {
  const geheimnis = base32(crypto.randomBytes(20));
  const r = await db.run(
    `INSERT INTO zweiter_faktor (user_id, geheimnis) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET geheimnis = EXCLUDED.geheimnis, letzter_schritt = 0, eingerichtet_am = NOW()
       WHERE zweiter_faktor.aktiv = FALSE`, [uid, geheimnis]);
  return (r.changes ?? 0) > 0 ? geheimnis : null;
}

/** Einrichtung mit einem Code aus der App bestätigen. @returns die Wiederherstellungscodes, oder null */
export async function bestaetigeEinrichtung(uid: number, code: string): Promise<string[] | null> {
  return db.transaction(async (tx) => {
    const z = await tx.get('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1 AND aktiv = FALSE FOR UPDATE', [uid]);
    if (!z) return null;
    const schritt = passenderSchritt(z.geheimnis, String(code ?? '').trim());
    if (schritt === null) return null;
    await tx.run('UPDATE zweiter_faktor SET aktiv = TRUE, letzter_schritt = $2 WHERE user_id = $1', [uid, schritt]);
    return codesErsetzen(tx, uid);
  });
}

/**
 * Einen Code beim Anmelden prüfen: sechsstelliger Einmalcode oder ein
 * Wiederherstellungscode. Beide gelten genau einmal — die Bedingung steht im
 * UPDATE, damit zwei gleichzeitige Anmeldungen nicht beide durchkommen.
 */
export async function pruefeCode(uid: number, code: unknown): Promise<'totp' | 'wiederherstellung' | null> {
  const eingabe = String(code ?? '').trim();
  if (!eingabe) return null;
  if (/^\d{6}$/.test(eingabe)) {
    const z = await db.get('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1 AND aktiv', [uid]);
    const schritt = z ? passenderSchritt(z.geheimnis, eingabe) : null;
    if (schritt === null) return null;
    const r = await db.run(
      'UPDATE zweiter_faktor SET letzter_schritt = $2 WHERE user_id = $1 AND aktiv AND letzter_schritt < $2', [uid, schritt]);
    return (r.changes ?? 0) > 0 ? 'totp' : null;
  }
  const r = await db.run(
    `UPDATE zweiter_faktor_codes SET verbraucht_am = NOW()
      WHERE user_id = $1 AND code_hash = $2 AND verbraucht_am IS NULL
        AND EXISTS (SELECT 1 FROM zweiter_faktor WHERE user_id = $1 AND aktiv)`, [uid, hashCode(eingabe)]);
  return (r.changes ?? 0) > 0 ? 'wiederherstellung' : null;
}

export async function schalteAb(uid: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM zweiter_faktor_codes WHERE user_id = $1', [uid]);
    await tx.run('DELETE FROM zweiter_faktor WHERE user_id = $1', [uid]);
  });
}

export async function erneuereCodes(uid: number): Promise<string[]> {
  return db.transaction(tx => codesErsetzen(tx, uid));
}
