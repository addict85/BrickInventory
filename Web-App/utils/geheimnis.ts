import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Geheimnisse (Gutschein-PIN, TOTP, API-Schlüssel, SMTP-Passwort) liegen
 * verschlüsselt in der Datenbank. Ein Abzug der Datenbank allein gibt sie
 * dann nicht preis; der Schlüssel liegt im App-Datenverzeichnis oder in DATA_KEY.
 */
const PRAEFIX = 'v1:';
let geladen: Buffer | null = null;

function schluesselDatei(): string {
  const { DATA_DIR } = require('./appPaths') as { DATA_DIR: string };
  return path.join(DATA_DIR, '.datenschluessel');
}

/** 32 Byte aus DATA_KEY (base64) oder der Schlüsseldatei; fehlt beides, wird die Datei angelegt. */
export function datenSchluessel(): Buffer {
  if (geladen) return geladen;
  const env = (process.env.DATA_KEY || '').trim();
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

/**
 * Entschlüsseln; Klartext aus der Zeit davor kommt unverändert zurück. Passt
 * der Schlüssel nicht (Datei verloren), gibt es null statt eines falschen Werts.
 */
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

/** Kennung verschlüsselter Dateien; ein PDF beginnt nie so. */
const DATEI_KOPF = Buffer.from('BIENC1\n', 'ascii');

export function istVerschluesselterPuffer(daten: Buffer): boolean {
  return daten.subarray(0, DATEI_KOPF.length).equals(DATEI_KOPF);
}

/** Eine Datei mit AES-256-GCM: Kopf, IV, Tag, Inhalt. */
export function verschluesselePuffer(daten: Buffer): Buffer {
  if (istVerschluesselterPuffer(daten)) return daten;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', datenSchluessel(), iv);
  const inhalt = Buffer.concat([c.update(daten), c.final()]);
  return Buffer.concat([DATEI_KOPF, iv, c.getAuthTag(), inhalt]);
}

/**
 * Entschlüsseln; eine Datei aus der Zeit davor kommt unverändert zurück.
 * Passt der Schlüssel nicht oder wurde die Datei verändert, gibt es null.
 */
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

/** Nur für Tests: den geladenen Schlüssel vergessen. */
export function _vergissSchluessel() { geladen = null; }
