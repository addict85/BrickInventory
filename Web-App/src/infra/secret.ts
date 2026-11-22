import { config } from './config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, DATA_DIR } from './appPaths';
import { processWide } from './processWide';

/** A dump of the database or of data/ alone does not reveal the secrets:
 * the key is in DATA_KEY or in a file of its own
 * outside the data folder (DATA_KEY_FILE, default schluessel/). */
/** v2: AES-256-GCM with context (AAD); v1 without, only readable for re-encryption. */
const V1 = 'v1:',
  V2 = 'v2:';
/** The keys, read and derived once. */
const S = processWide('dataKey', () => ({
  loaded: null as Buffer | null,
  alt: undefined as Buffer | null | undefined,
  altV2: null as Buffer | null,
  v2: null as Buffer | null,
}));

export function keyFile(): string {
  return config().dataKeyFile || path.join(APP_ROOT, 'schluessel', 'datenschluessel');
}

/** The location used by older installations; it is part of every backup of data/. */
export function oldKeyFile(): string {
  return path.join(DATA_DIR, '.datenschluessel');
}

function readSecretKey(file: string): Buffer | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  const k = Buffer.from(raw.trim(), 'base64');
  if (k.length !== 32)
    throw new Error(`${file} enthält keinen Datenschlüssel (32 Byte als base64, openssl rand -base64 32)`);
  return k;
}

function warnAlterLocation(alt: string, fresh: string): void {
  console.warn(
    `⚠️  [geheimnis] Der Datenschlüssel liegt im Datenordner (${alt}) und damit in jeder Sicherung von data/. ` +
      `Bitte umziehen: Server anhalten, die Datei nach ${fresh} verschieben (compose.yaml: ./schluessel/datenschluessel) ` +
      'und wieder starten — Schritte in UPGRADE.md#datenschluessel-ort.',
  );
}

/** Order: DATA_KEY, the own file, the old file in the data folder
 * (with a warning); if everything is missing, the own file is created. */
export function dataKey(): Buffer {
  if (S.loaded) return S.loaded;
  const env = config().dataKey;
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('DATA_KEY muss 32 Byte als base64 sein (openssl rand -base64 32)');
    S.loaded = k;
    return k;
  }
  const file = keyFile(),
    alt = oldKeyFile();
  const k = readSecretKey(file),
    altK = readSecretKey(alt);
  if (k && altK && !k.equals(altK))
    throw new Error(
      `Zwei verschiedene Datenschlüssel: ${file} und ${alt}. Den gültigen behalten, den anderen entfernen (UPGRADE.md).`,
    );
  if (k) {
    if (altK)
      console.warn(
        `⚠️  [geheimnis] ${alt} ist eine Kopie von ${file} und liegt in jeder Sicherung von data/ — bitte löschen.`,
      );
    S.loaded = k;
    return k;
  }
  if (altK) {
    warnAlterLocation(alt, file);
    S.loaded = altK;
    return altK;
  }
  const fresh = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Write completely first, then link: link() fails if a
  // second process was faster, and nobody reads a half-written file.
  const tmp = `${file}.${process.pid}`;
  fs.writeFileSync(tmp, fresh.toString('base64'), { mode: 0o600 });
  let result: Buffer = fresh;
  try {
    fs.linkSync(tmp, file);
  } catch {
    result = readSecretKey(file) ?? fresh;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  S.loaded = result;
  return result;
}

/** The previous key of a rotation: what only it opens stays readable until startup
 * rewrites it (scripts/rotate-data-key.sh). Missing file: no rotation. */
export function altKey(): Buffer | null {
  if (S.alt !== undefined) return S.alt;
  const k = config();
  const raw = k.dataKeyAlt
    ? Buffer.from(k.dataKeyAlt, 'base64')
    : k.dataKeyAltFile
      ? readSecretKey(k.dataKeyAltFile)
      : null;
  if (raw?.equals(dataKey())) {
    console.warn('⚠️ [geheimnis] DATA_KEY_ALT ist derselbe Schlüssel wie der aktuelle — kein Wechsel.');
    S.alt = null;
    return null;
  }
  S.alt = raw;
  return raw;
}

function altV2Key(): Buffer | null {
  const a = altKey();
  if (!a) return null;
  S.altV2 ??= Buffer.from(crypto.hkdfSync('sha256', a, Buffer.alloc(0), 'brickinventory/geheimnis/v2', 32));
  return S.altV2;
}

/** What and which row a ciphertext applies to (AAD in AES-GCM): copied into another
 * column, another account or another row, it is unreadable. */
export type Context = string & { readonly __context: true };
export function context(purpose: string, ...basis: (string | number)[]): Context {
  return JSON.stringify([purpose, ...basis.map(String)]) as Context;
}

/** An own subkey for v2: the same raw key otherwise also serves v1 and suchwert(). */
function v2Key(): Buffer {
  S.v2 ??= Buffer.from(crypto.hkdfSync('sha256', dataKey(), Buffer.alloc(0), 'brickinventory/geheimnis/v2', 32));
  return S.v2;
}

/** The tag length is fixed: otherwise GCM would also accept a truncated tag when opening,
 * and 4 bytes could be brute-forced. */
const IV = 12,
  TAG = 16;

function seal(key: Buffer, data: Buffer, aad: Context | null): Buffer {
  const iv = crypto.randomBytes(IV);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG });
  if (aad !== null) c.setAAD(Buffer.from(aad, 'utf8'));
  const content = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), content]);
}

/** null if key, content or context do not match. */
function open(key: Buffer, raw: Buffer, aad: Context | null): Buffer | null {
  if (raw.length < IV + TAG) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV), { authTagLength: TAG });
    if (aad !== null) d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(raw.subarray(IV, IV + TAG));
    return Buffer.concat([d.update(raw.subarray(IV + TAG)), d.final()]);
  } catch {
    return null;
  }
}

function warn(was: string): void {
  console.warn(
    `⚠️ [geheimnis] ${was} passt nicht zum Datenschlüssel (DATA_KEY oder DATA_KEY_FILE) oder gehört an eine andere Stelle.`,
  );
}

export function isEncrypted(wert: unknown): boolean {
  return typeof wert === 'string' && wert.startsWith(V2);
}

export function encrypt(plaintext: string | null | undefined, k: Context): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext ?? null;
  return V2 + seal(v2Key(), Buffer.from(String(plaintext), 'utf8'), k).toString('base64');
}

/** Only v2: plaintext and v1 are read only by the re-encryption at startup (readOldValue). */
export function decrypt(wert: string | null | undefined, k: Context): string | null {
  if (wert === null || wert === undefined) return null;
  if (wert === '') return '';
  if (!isEncrypted(wert)) {
    warn('Ein gespeicherter Wert ohne v2-Verschlüsselung');
    return null;
  }
  const raw = Buffer.from(wert.slice(V2.length), 'base64');
  const plain = open(v2Key(), raw, k) ?? withAltKey(raw, k);
  if (plain === null) warn('Ein gespeichertes Geheimnis');
  return plain === null ? null : plain.toString('utf8');
}

function withAltKey(raw: Buffer, k: Context): Buffer | null {
  const a = altV2Key();
  return a ? open(a, raw, k) : null;
}

/** For re-encryption: v2, v1 (without context) and plaintext from before the encryption. */
export function readOldValue(wert: string | null | undefined, k: Context): string | null {
  if (wert === null || wert === undefined) return null;
  if (isEncrypted(wert)) return decrypt(wert, k);
  if (!wert.startsWith(V1)) return wert;
  const plain = open(dataKey(), Buffer.from(wert.slice(V1.length), 'base64'), null);
  if (plain === null) warn('Ein gespeichertes Geheimnis (v1)');
  return plain === null ? null : plain.toString('utf8');
}

/** The new value; undefined if there is nothing to do or it is unreadable (row stays). */
export function rekey(wert: string | null | undefined, k: Context): string | null | undefined {
  if (!wert) return undefined;
  if (isEncrypted(wert)) {
    const raw = Buffer.from(wert.slice(V2.length), 'base64');
    if (!altV2Key() || open(v2Key(), raw, k) !== null) return undefined;
    const plain = withAltKey(raw, k);
    return plain === null ? undefined : encrypt(plain.toString('utf8'), k);
  }
  const plain = readOldValue(wert, k);
  return plain === null ? undefined : encrypt(plain, k);
}

/** HMAC instead of a hash: small value ranges (card numbers with a fixed prefix)
 * could otherwise be brute-forced. One key per purpose. */
export function searchValue(purpose: string, wert: string): string {
  return searchValueWith(dataKey(), purpose, wert);
}

/** The same search value under the previous key while a rotation is running. */
export function searchValueAlt(purpose: string, wert: string): string | null {
  const a = altKey();
  return a ? searchValueWith(a, purpose, wert) : null;
}

function searchValueWith(key: Buffer, purpose: string, wert: string): string {
  const k = Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), `brickinventory/suche/${purpose}`, 32));
  return crypto.createHmac('sha256', k).update(wert, 'utf8').digest('hex');
}

/** A PDF never starts like this. */
const HEADER1 = Buffer.from('BIENC1\n', 'ascii');
const HEADER2 = Buffer.from('BIENC2\n', 'ascii');
const beginsWith = (data: Buffer, header: Buffer) => data.subarray(0, header.length).equals(header);

export function isEncryptedBuffer(data: Buffer): boolean {
  return beginsWith(data, HEADER2);
}

export function encryptBuffer(data: Buffer, k: Context): Buffer {
  return Buffer.concat([HEADER2, seal(v2Key(), data, k)]);
}

/** Only BIENC2 with a matching context; otherwise null. */
export function decryptBuffer(data: Buffer, k: Context): Buffer | null {
  const raw = data.subarray(HEADER2.length);
  const plain = isEncryptedBuffer(data) ? (open(v2Key(), raw, k) ?? withAltKey(raw, k)) : null;
  if (plain === null) warn('Eine verschlüsselte Datei');
  return plain;
}

/** A BIENC2 file that only the previous key opens, with the new one; otherwise undefined. */
export function rekeyBuffer(data: Buffer, k: Context): Buffer | undefined {
  if (!isEncryptedBuffer(data) || !altV2Key()) return undefined;
  const raw = data.subarray(HEADER2.length);
  if (open(v2Key(), raw, k) !== null) return undefined;
  const plain = withAltKey(raw, k);
  return plain === null ? undefined : encryptBuffer(plain, k);
}

/** For re-encryption: BIENC2, BIENC1 and unencrypted files. */
export function readOldBuffer(data: Buffer, k: Context): Buffer | null {
  if (isEncryptedBuffer(data)) return decryptBuffer(data, k);
  if (!beginsWith(data, HEADER1)) return data;
  const plain = open(dataKey(), data.subarray(HEADER1.length), null);
  if (plain === null) warn('Eine verschlüsselte Datei (BIENC1)');
  return plain;
}

export function _forgetKey() {
  S.loaded = null;
  S.v2 = null;
  S.alt = undefined;
  S.altV2 = null;
}
