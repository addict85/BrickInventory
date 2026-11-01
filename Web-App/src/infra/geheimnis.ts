import { konfig } from './konfig';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './appPaths';

/** Ein Abzug der Datenbank allein gibt die Geheimnisse nicht preis; der
 * Schlüssel liegt im App-Datenverzeichnis oder in DATA_KEY. */
const PRAEFIX = 'v1:';
let geladen: Buffer | null = null;

function schluesselDatei(): string {
  return path.join(DATA_DIR, '.datenschluessel');
}

/** Fehlt beides, wird die Datei angelegt. */
export function datenSchluessel(): Buffer {
  if (geladen) return geladen;
  const env = konfig().datenSchluessel;
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('DATA_KEY muss 32 Byte als base64 sein (openssl rand -base64 32)');
    return (geladen = k);
  }
  const datei = schluesselDatei();
  try {
    const k = Buffer.from(fs.readFileSync(datei, 'utf8').trim(), 'base64');
    if (k.length === 32) return (geladen = k);
  } catch { /* noch keine Datei: unten anlegen */ }
  const neu = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  // Erst vollständig schreiben, dann verlinken: link() scheitert, wenn ein
  // zweiter Prozess schneller war, und niemand liest eine halb geschriebene Datei.
  const tmp = `${datei}.${process.pid}`;
  fs.writeFileSync(tmp, neu.toString('base64'), { mode: 0o600 });
  try { fs.linkSync(tmp, datei); return (geladen = neu); }
  catch { return (geladen = Buffer.from(fs.readFileSync(datei, 'utf8').trim(), 'base64')); }
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
    console.warn('⚠️ [geheimnis] Ein gespeichertes Geheimnis passt nicht zum Datenschlüssel (data/.datenschluessel oder DATA_KEY).');
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
    console.warn('⚠️ [geheimnis] Eine verschlüsselte Datei passt nicht zum Datenschlüssel (data/.datenschluessel oder DATA_KEY).');
    return null;
  }
}

export function _vergissSchluessel() { geladen = null; }
