import { konfig } from './konfig';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, DATA_DIR } from './appPaths';

/** Ein Abzug der Datenbank oder von data/ allein gibt die Geheimnisse nicht
 * preis: Der Schlüssel liegt in DATA_KEY oder in einer eigenen Datei
 * ausserhalb des Datenordners (DATA_KEY_FILE, Vorgabe schluessel/). */
const PRAEFIX = 'v1:';
let geladen: Buffer | null = null;

export function schluesselDatei(): string {
  return konfig().datenSchluesselDatei || path.join(APP_ROOT, 'schluessel', 'datenschluessel');
}

/** Der Ort älterer Installationen; er liegt mit in jeder Sicherung von data/. */
export function alteSchluesselDatei(): string {
  return path.join(DATA_DIR, '.datenschluessel');
}

function lies(datei: string): Buffer | null {
  let roh: string;
  try { roh = fs.readFileSync(datei, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  const k = Buffer.from(roh.trim(), 'base64');
  if (k.length !== 32) throw new Error(`${datei} enthält keinen Datenschlüssel (32 Byte als base64, openssl rand -base64 32)`);
  return k;
}

function warneAlterOrt(alt: string, neu: string): void {
  console.warn(`⚠️  [geheimnis] Der Datenschlüssel liegt im Datenordner (${alt}) und damit in jeder Sicherung von data/. ` +
    `Bitte umziehen: Server anhalten, die Datei nach ${neu} verschieben (compose.yaml: ./schluessel/datenschluessel) ` +
    'und wieder starten — Schritte in UPGRADE.md, Abschnitt „Datenschlüssel ausserhalb von data/".');
}

/** Reihenfolge: DATA_KEY, die eigene Datei, die alte Datei im Datenordner
 * (mit Warnung); fehlt alles, wird die eigene Datei angelegt. */
export function datenSchluessel(): Buffer {
  if (geladen) return geladen;
  const env = konfig().datenSchluessel;
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('DATA_KEY muss 32 Byte als base64 sein (openssl rand -base64 32)');
    return (geladen = k);
  }
  const datei = schluesselDatei(), alt = alteSchluesselDatei();
  const k = lies(datei), altK = lies(alt);
  if (k && altK && !k.equals(altK))
    throw new Error(`Zwei verschiedene Datenschlüssel: ${datei} und ${alt}. Den gültigen behalten, den anderen entfernen (UPGRADE.md).`);
  if (k) {
    if (altK) console.warn(`⚠️  [geheimnis] ${alt} ist eine Kopie von ${datei} und liegt in jeder Sicherung von data/ — bitte löschen.`);
    return (geladen = k);
  }
  if (altK) { warneAlterOrt(alt, datei); return (geladen = altK); }
  const neu = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(datei), { recursive: true, mode: 0o700 });
  // Erst vollständig schreiben, dann verlinken: link() scheitert, wenn ein
  // zweiter Prozess schneller war, und niemand liest eine halb geschriebene Datei.
  const tmp = `${datei}.${process.pid}`;
  fs.writeFileSync(tmp, neu.toString('base64'), { mode: 0o600 });
  try { fs.linkSync(tmp, datei); return (geladen = neu); }
  catch { return (geladen = lies(datei) ?? neu); }
  finally { fs.rmSync(tmp, { force: true }); }
}

export function istVerschluesselt(wert: unknown): boolean {
  return typeof wert === 'string' && wert.startsWith(PRAEFIX);
}

export function verschluessele(klartext: string | null | undefined): string | null {
  if (klartext === null || klartext === undefined || klartext === '') return klartext ?? null;
  if (istVerschluesselt(klartext)) return klartext;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', datenSchluessel(), iv);
  const daten = Buffer.concat([c.update(String(klartext), 'utf8'), c.final()]);
  return PRAEFIX + Buffer.concat([iv, c.getAuthTag(), daten]).toString('base64');
}

/** Passt der Schlüssel nicht (Datei verloren), null statt eines falschen Werts. */
export function entschluessele(wert: string | null | undefined): string | null {
  if (wert === null || wert === undefined) return null;
  if (!istVerschluesselt(wert)) return wert;
  try {
    const roh = Buffer.from(wert.slice(PRAEFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', datenSchluessel(), roh.subarray(0, 12));
    d.setAuthTag(roh.subarray(12, 28));
    return Buffer.concat([d.update(roh.subarray(28)), d.final()]).toString('utf8');
  } catch {
    console.warn('⚠️ [geheimnis] Ein gespeichertes Geheimnis passt nicht zum Datenschlüssel (DATA_KEY oder DATA_KEY_FILE).');
    return null;
  }
}

/** HMAC statt Hash: Kleine Wertebereiche (Kartennummern mit festem Präfix)
 * liessen sich sonst durchprobieren. Ein Schlüssel je Zweck. */
export function suchwert(zweck: string, wert: string): string {
  const k = Buffer.from(crypto.hkdfSync('sha256', datenSchluessel(), Buffer.alloc(0), `brickinventory/suche/${zweck}`, 32));
  return crypto.createHmac('sha256', k).update(wert, 'utf8').digest('hex');
}

/** Ein PDF beginnt nie so. */
const DATEI_KOPF = Buffer.from('BIENC1\n', 'ascii');

export function istVerschluesselterPuffer(daten: Buffer): boolean {
  return daten.subarray(0, DATEI_KOPF.length).equals(DATEI_KOPF);
}

export function verschluesselePuffer(daten: Buffer): Buffer {
  if (istVerschluesselterPuffer(daten)) return daten;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', datenSchluessel(), iv);
  const inhalt = Buffer.concat([c.update(daten), c.final()]);
  return Buffer.concat([DATEI_KOPF, iv, c.getAuthTag(), inhalt]);
}

/** Verändert oder falscher Schlüssel: null. */
export function entschluesselePuffer(daten: Buffer): Buffer | null {
  if (!istVerschluesselterPuffer(daten)) return daten;
  try {
    const roh = daten.subarray(DATEI_KOPF.length);
    const d = crypto.createDecipheriv('aes-256-gcm', datenSchluessel(), roh.subarray(0, 12));
    d.setAuthTag(roh.subarray(12, 28));
    return Buffer.concat([d.update(roh.subarray(28)), d.final()]);
  } catch {
    console.warn('⚠️ [geheimnis] Eine verschlüsselte Datei passt nicht zum Datenschlüssel (DATA_KEY oder DATA_KEY_FILE).');
    return null;
  }
}

export function _vergissSchluessel() { geladen = null; }
