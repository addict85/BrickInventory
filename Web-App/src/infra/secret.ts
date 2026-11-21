import { konfig } from './config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, DATA_DIR } from './appPaths';
import { prozessweit } from './prozessweit';

/** A dump of the database or of data/ alone does not reveal the secrets:
 * the key is in DATA_KEY or in a file of its own
 * outside the data folder (DATA_KEY_FILE, default schluessel/). */
/** v2: AES-256-GCM with context (AAD); v1 without, only readable for re-encryption. */
const V1 = 'v1:',
  V2 = 'v2:';
/** The keys, read and derived once. */
const S = prozessweit('datenSchluessel', () => ({
  geladen: null as Buffer | null,
  alt: undefined as Buffer | null | undefined,
  altV2: null as Buffer | null,
  v2: null as Buffer | null,
}));

export function keyFile(): string {
  return konfig().dataKeyFile || path.join(APP_ROOT, 'schluessel', 'datenschluessel');
}

/** The location used by older installations; it is part of every backup of data/. */
export function oldKeyFile(): string {
  return path.join(DATA_DIR, '.datenschluessel');
}

function readSecretKey(datei: string): Buffer | null {
  let roh: string;
  try {
    roh = fs.readFileSync(datei, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  const k = Buffer.from(roh.trim(), 'base64');
  if (k.length !== 32)
    throw new Error(`${datei} enthält keinen Datenschlüssel (32 Byte als base64, openssl rand -base64 32)`);
  return k;
}

function warnAlterLocation(alt: string, neu: string): void {
  console.warn(
    `⚠️  [geheimnis] Der Datenschlüssel liegt im Datenordner (${alt}) und damit in jeder Sicherung von data/. ` +
      `Bitte umziehen: Server anhalten, die Datei nach ${neu} verschieben (compose.yaml: ./schluessel/datenschluessel) ` +
      'und wieder starten — Schritte in UPGRADE.md#datenschluessel-ort.',
  );
}

/** Order: DATA_KEY, the own file, the old file in the data folder
 * (with a warning); if everything is missing, the own file is created. */
export function datenSchluessel(): Buffer {
  if (S.geladen) return S.geladen;
  const env = konfig().datenSchluessel;
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('DATA_KEY muss 32 Byte als base64 sein (openssl rand -base64 32)');
    S.geladen = k;
    return k;
  }
  const datei = keyFile(),
    alt = oldKeyFile();
  const k = readSecretKey(datei),
    altK = readSecretKey(alt);
  if (k && altK && !k.equals(altK))
    throw new Error(
      `Zwei verschiedene Datenschlüssel: ${datei} und ${alt}. Den gültigen behalten, den anderen entfernen (UPGRADE.md).`,
    );
  if (k) {
    if (altK)
      console.warn(
        `⚠️  [geheimnis] ${alt} ist eine Kopie von ${datei} und liegt in jeder Sicherung von data/ — bitte löschen.`,
      );
    S.geladen = k;
    return k;
  }
  if (altK) {
    warnAlterLocation(alt, datei);
    S.geladen = altK;
    return altK;
  }
  const neu = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(datei), { recursive: true, mode: 0o700 });
  // Write completely first, then link: link() fails if a
  // second process was faster, and nobody reads a half-written file.
  const tmp = `${datei}.${process.pid}`;
  fs.writeFileSync(tmp, neu.toString('base64'), { mode: 0o600 });
  let ergebnis: Buffer = neu;
  try {
    fs.linkSync(tmp, datei);
  } catch {
    ergebnis = readSecretKey(datei) ?? neu;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  S.geladen = ergebnis;
  return ergebnis;
}

/** The previous key of a rotation: what only it opens stays readable until startup
 * rewrites it (scripts/datenschluessel-wechseln.sh). Missing file: no rotation. */
export function altKey(): Buffer | null {
  if (S.alt !== undefined) return S.alt;
  const k = konfig();
  const roh = k.dataKeyAlt
    ? Buffer.from(k.dataKeyAlt, 'base64')
    : k.dataKeyAltFile
      ? readSecretKey(k.dataKeyAltFile)
      : null;
  if (roh?.equals(datenSchluessel())) {
    console.warn('⚠️ [geheimnis] DATA_KEY_ALT ist derselbe Schlüssel wie der aktuelle — kein Wechsel.');
    S.alt = null;
    return null;
  }
  S.alt = roh;
  return roh;
}

function altV2Key(): Buffer | null {
  const a = altKey();
  if (!a) return null;
  S.altV2 ??= Buffer.from(crypto.hkdfSync('sha256', a, Buffer.alloc(0), 'brickinventory/geheimnis/v2', 32));
  return S.altV2;
}

/** What and which row a ciphertext applies to (AAD in AES-GCM): copied into another
 * column, another account or another row, it is unreadable. */
export type Kontext = string & { readonly __context: true };
export function kontext(zweck: string, ...bezug: (string | number)[]): Kontext {
  return JSON.stringify([zweck, ...bezug.map(String)]) as Kontext;
}

/** An own subkey for v2: the same raw key otherwise also serves v1 and suchwert(). */
function v2Key(): Buffer {
  S.v2 ??= Buffer.from(
    crypto.hkdfSync('sha256', datenSchluessel(), Buffer.alloc(0), 'brickinventory/geheimnis/v2', 32),
  );
  return S.v2;
}

/** The tag length is fixed: otherwise GCM would also accept a truncated tag when opening,
 * and 4 bytes could be brute-forced. */
const IV = 12,
  TAG = 16;

function seal(schluessel: Buffer, daten: Buffer, aad: Kontext | null): Buffer {
  const iv = crypto.randomBytes(IV);
  const c = crypto.createCipheriv('aes-256-gcm', schluessel, iv, { authTagLength: TAG });
  if (aad !== null) c.setAAD(Buffer.from(aad, 'utf8'));
  const inhalt = Buffer.concat([c.update(daten), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), inhalt]);
}

/** null if key, content or context do not match. */
function oeffne(schluessel: Buffer, roh: Buffer, aad: Kontext | null): Buffer | null {
  if (roh.length < IV + TAG) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', schluessel, roh.subarray(0, IV), { authTagLength: TAG });
    if (aad !== null) d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(roh.subarray(IV, IV + TAG));
    return Buffer.concat([d.update(roh.subarray(IV + TAG)), d.final()]);
  } catch {
    return null;
  }
}

function warne(was: string): void {
  console.warn(
    `⚠️ [geheimnis] ${was} passt nicht zum Datenschlüssel (DATA_KEY oder DATA_KEY_FILE) oder gehört an eine andere Stelle.`,
  );
}

export function isEncrypted(wert: unknown): boolean {
  return typeof wert === 'string' && wert.startsWith(V2);
}

export function encrypt(klartext: string | null | undefined, k: Kontext): string | null {
  if (klartext === null || klartext === undefined || klartext === '') return klartext ?? null;
  return V2 + seal(v2Key(), Buffer.from(String(klartext), 'utf8'), k).toString('base64');
}

/** Only v2: plaintext and v1 are read only by the re-encryption at startup (readOldValue). */
export function decrypt(wert: string | null | undefined, k: Kontext): string | null {
  if (wert === null || wert === undefined) return null;
  if (wert === '') return '';
  if (!isEncrypted(wert)) {
    warne('Ein gespeicherter Wert ohne v2-Verschlüsselung');
    return null;
  }
  const roh = Buffer.from(wert.slice(V2.length), 'base64');
  const klar = oeffne(v2Key(), roh, k) ?? withAltKey(roh, k);
  if (klar === null) warne('Ein gespeichertes Geheimnis');
  return klar === null ? null : klar.toString('utf8');
}

function withAltKey(roh: Buffer, k: Kontext): Buffer | null {
  const a = altV2Key();
  return a ? oeffne(a, roh, k) : null;
}

/** For re-encryption: v2, v1 (without context) and plaintext from before the encryption. */
export function readOldValue(wert: string | null | undefined, k: Kontext): string | null {
  if (wert === null || wert === undefined) return null;
  if (isEncrypted(wert)) return decrypt(wert, k);
  if (!wert.startsWith(V1)) return wert;
  const klar = oeffne(datenSchluessel(), Buffer.from(wert.slice(V1.length), 'base64'), null);
  if (klar === null) warne('Ein gespeichertes Geheimnis (v1)');
  return klar === null ? null : klar.toString('utf8');
}

/** The new value; undefined if there is nothing to do or it is unreadable (row stays). */
export function umschluesseln(wert: string | null | undefined, k: Kontext): string | null | undefined {
  if (!wert) return undefined;
  if (isEncrypted(wert)) {
    const roh = Buffer.from(wert.slice(V2.length), 'base64');
    if (!altV2Key() || oeffne(v2Key(), roh, k) !== null) return undefined;
    const klar = withAltKey(roh, k);
    return klar === null ? undefined : encrypt(klar.toString('utf8'), k);
  }
  const klar = readOldValue(wert, k);
  return klar === null ? undefined : encrypt(klar, k);
}

/** HMAC instead of a hash: small value ranges (card numbers with a fixed prefix)
 * could otherwise be brute-forced. One key per purpose. */
export function searchValue(zweck: string, wert: string): string {
  return searchValueWith(datenSchluessel(), zweck, wert);
}

/** The same search value under the previous key while a rotation is running. */
export function searchValueAlt(zweck: string, wert: string): string | null {
  const a = altKey();
  return a ? searchValueWith(a, zweck, wert) : null;
}

function searchValueWith(schluessel: Buffer, zweck: string, wert: string): string {
  const k = Buffer.from(crypto.hkdfSync('sha256', schluessel, Buffer.alloc(0), `brickinventory/suche/${zweck}`, 32));
  return crypto.createHmac('sha256', k).update(wert, 'utf8').digest('hex');
}

/** A PDF never starts like this. */
const KOPF1 = Buffer.from('BIENC1\n', 'ascii');
const KOPF2 = Buffer.from('BIENC2\n', 'ascii');
const beginsWith = (daten: Buffer, kopf: Buffer) => daten.subarray(0, kopf.length).equals(kopf);

export function isEncryptedBuffer(daten: Buffer): boolean {
  return beginsWith(daten, KOPF2);
}

export function encryptBuffer(daten: Buffer, k: Kontext): Buffer {
  return Buffer.concat([KOPF2, seal(v2Key(), daten, k)]);
}

/** Only BIENC2 with a matching context; otherwise null. */
export function decryptBuffer(daten: Buffer, k: Kontext): Buffer | null {
  const roh = daten.subarray(KOPF2.length);
  const klar = isEncryptedBuffer(daten) ? (oeffne(v2Key(), roh, k) ?? withAltKey(roh, k)) : null;
  if (klar === null) warne('Eine verschlüsselte Datei');
  return klar;
}

/** A BIENC2 file that only the previous key opens, with the new one; otherwise undefined. */
export function pufferUmschluesseln(daten: Buffer, k: Kontext): Buffer | undefined {
  if (!isEncryptedBuffer(daten) || !altV2Key()) return undefined;
  const roh = daten.subarray(KOPF2.length);
  if (oeffne(v2Key(), roh, k) !== null) return undefined;
  const klar = withAltKey(roh, k);
  return klar === null ? undefined : encryptBuffer(klar, k);
}

/** For re-encryption: BIENC2, BIENC1 and unencrypted files. */
export function readOldBuffer(daten: Buffer, k: Kontext): Buffer | null {
  if (isEncryptedBuffer(daten)) return decryptBuffer(daten, k);
  if (!beginsWith(daten, KOPF1)) return daten;
  const klar = oeffne(datenSchluessel(), daten.subarray(KOPF1.length), null);
  if (klar === null) warne('Eine verschlüsselte Datei (BIENC1)');
  return klar;
}

export function _forgetKey() {
  S.geladen = null;
  S.v2 = null;
  S.alt = undefined;
  S.altV2 = null;
}
