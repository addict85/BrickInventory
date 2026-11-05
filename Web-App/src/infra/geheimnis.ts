import { konfig } from './konfig';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, DATA_DIR } from './appPaths';

/** Ein Abzug der Datenbank oder von data/ allein gibt die Geheimnisse nicht
 * preis: Der Schlüssel liegt in DATA_KEY oder in einer eigenen Datei
 * ausserhalb des Datenordners (DATA_KEY_FILE, Vorgabe schluessel/). */
/** v2: AES-256-GCM mit Kontext (AAD); v1 ohne, nur noch zum Umschlüsseln lesbar. */
const V1 = 'v1:', V2 = 'v2:';
let geladen: Buffer | null = null;

export function schluesselDatei(): string {
  return konfig().datenSchluesselDatei || path.join(APP_ROOT, 'schluessel', 'datenschluessel');
}

/** Der Ort älterer Installationen; er liegt mit in jeder Sicherung von data/. */
export function alteSchluesselDatei(): string {
  return path.join(DATA_DIR, '.datenschluessel');
}

function liesSchluessel(datei: string): Buffer | null {
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
  const k = liesSchluessel(datei), altK = liesSchluessel(alt);
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
  catch { return (geladen = liesSchluessel(datei) ?? neu); }
  finally { fs.rmSync(tmp, { force: true }); }
}

/** Der vorige Schlüssel eines Wechsels: Was nur er öffnet, bleibt lesbar, bis der Start
 * es neu schreibt (scripts/datenschluessel-wechseln.sh). Fehlende Datei: kein Wechsel. */
let alt: Buffer | null | undefined;
export function altSchluessel(): Buffer | null {
  if (alt !== undefined) return alt;
  const k = konfig();
  const roh = k.datenSchluesselAlt ? Buffer.from(k.datenSchluesselAlt, 'base64')
    : k.datenSchluesselAltDatei ? liesSchluessel(k.datenSchluesselAltDatei) : null;
  if (roh && roh.equals(datenSchluessel())) {
    console.warn('⚠️ [geheimnis] DATA_KEY_ALT ist derselbe Schlüssel wie der aktuelle — kein Wechsel.');
    return (alt = null);
  }
  return (alt = roh);
}

let altV2: Buffer | null = null;
function altV2Schluessel(): Buffer | null {
  const a = altSchluessel();
  return a ? (altV2 ??= Buffer.from(crypto.hkdfSync('sha256', a, Buffer.alloc(0), 'brickinventory/geheimnis/v2', 32))) : null;
}

/** Wofür und für welche Zeile ein Geheimtext gilt (AAD in AES-GCM): In eine andere
 * Spalte, ein anderes Konto oder eine andere Zeile kopiert, ist er unlesbar. */
export type Kontext = string & { readonly __kontext: true };
export function kontext(zweck: string, ...bezug: (string | number)[]): Kontext {
  return JSON.stringify([zweck, ...bezug.map(String)]) as Kontext;
}

/** Eigener Teilschlüssel für v2: Derselbe Rohschlüssel dient sonst auch v1 und suchwert(). */
let v2: Buffer | null = null;
function v2Schluessel(): Buffer {
  return v2 ??= Buffer.from(crypto.hkdfSync('sha256', datenSchluessel(), Buffer.alloc(0), 'brickinventory/geheimnis/v2', 32));
}

function versiegle(schluessel: Buffer, daten: Buffer, aad: Kontext | null): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', schluessel, iv);
  if (aad !== null) c.setAAD(Buffer.from(aad, 'utf8'));
  const inhalt = Buffer.concat([c.update(daten), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), inhalt]);
}

/** null, wenn Schlüssel, Inhalt oder Kontext nicht passen. */
function oeffne(schluessel: Buffer, roh: Buffer, aad: Kontext | null): Buffer | null {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', schluessel, roh.subarray(0, 12));
    if (aad !== null) d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(roh.subarray(12, 28));
    return Buffer.concat([d.update(roh.subarray(28)), d.final()]);
  } catch { return null; }
}

function warne(was: string): void {
  console.warn(`⚠️ [geheimnis] ${was} passt nicht zum Datenschlüssel (DATA_KEY oder DATA_KEY_FILE) oder gehört an eine andere Stelle.`);
}

export function istVerschluesselt(wert: unknown): boolean {
  return typeof wert === 'string' && wert.startsWith(V2);
}

export function verschluessele(klartext: string | null | undefined, k: Kontext): string | null {
  if (klartext === null || klartext === undefined || klartext === '') return klartext ?? null;
  return V2 + versiegle(v2Schluessel(), Buffer.from(String(klartext), 'utf8'), k).toString('base64');
}

/** Nur v2: Klartext und v1 liest allein das Umschlüsseln beim Start (altwertLesen). */
export function entschluessele(wert: string | null | undefined, k: Kontext): string | null {
  if (wert === null || wert === undefined) return null;
  if (wert === '') return '';
  if (!istVerschluesselt(wert)) { warne('Ein gespeicherter Wert ohne v2-Verschlüsselung'); return null; }
  const roh = Buffer.from(wert.slice(V2.length), 'base64');
  const klar = oeffne(v2Schluessel(), roh, k) ?? mitAltSchluessel(roh, k);
  if (klar === null) warne('Ein gespeichertes Geheimnis');
  return klar === null ? null : klar.toString('utf8');
}

function mitAltSchluessel(roh: Buffer, k: Kontext): Buffer | null {
  const a = altV2Schluessel();
  return a ? oeffne(a, roh, k) : null;
}

/** Für das Umschlüsseln: v2, v1 (ohne Kontext) und Klartext von vor der Verschlüsselung. */
export function altwertLesen(wert: string | null | undefined, k: Kontext): string | null {
  if (wert === null || wert === undefined) return null;
  if (istVerschluesselt(wert)) return entschluessele(wert, k);
  if (!wert.startsWith(V1)) return wert;
  const klar = oeffne(datenSchluessel(), Buffer.from(wert.slice(V1.length), 'base64'), null);
  if (klar === null) warne('Ein gespeichertes Geheimnis (v1)');
  return klar === null ? null : klar.toString('utf8');
}

/** Der neue Wert; undefined, wenn nichts zu tun ist oder er unlesbar ist (Zeile bleibt). */
export function umschluesseln(wert: string | null | undefined, k: Kontext): string | null | undefined {
  if (!wert) return undefined;
  if (istVerschluesselt(wert)) {
    const roh = Buffer.from(wert.slice(V2.length), 'base64');
    if (!altV2Schluessel() || oeffne(v2Schluessel(), roh, k) !== null) return undefined;
    const klar = mitAltSchluessel(roh, k);
    return klar === null ? undefined : verschluessele(klar.toString('utf8'), k);
  }
  const klar = altwertLesen(wert, k);
  return klar === null ? undefined : verschluessele(klar, k);
}

/** HMAC statt Hash: Kleine Wertebereiche (Kartennummern mit festem Präfix)
 * liessen sich sonst durchprobieren. Ein Schlüssel je Zweck. */
export function suchwert(zweck: string, wert: string): string {
  return suchwertMit(datenSchluessel(), zweck, wert);
}

/** Derselbe Suchwert unter dem vorigen Schlüssel, solange ein Wechsel läuft. */
export function suchwertAlt(zweck: string, wert: string): string | null {
  const a = altSchluessel();
  return a ? suchwertMit(a, zweck, wert) : null;
}

function suchwertMit(schluessel: Buffer, zweck: string, wert: string): string {
  const k = Buffer.from(crypto.hkdfSync('sha256', schluessel, Buffer.alloc(0), `brickinventory/suche/${zweck}`, 32));
  return crypto.createHmac('sha256', k).update(wert, 'utf8').digest('hex');
}

/** Ein PDF beginnt nie so. */
const KOPF1 = Buffer.from('BIENC1\n', 'ascii');
const KOPF2 = Buffer.from('BIENC2\n', 'ascii');
const beginntMit = (daten: Buffer, kopf: Buffer) => daten.subarray(0, kopf.length).equals(kopf);

export function istVerschluesselterPuffer(daten: Buffer): boolean {
  return beginntMit(daten, KOPF2);
}

export function verschluesselePuffer(daten: Buffer, k: Kontext): Buffer {
  return Buffer.concat([KOPF2, versiegle(v2Schluessel(), daten, k)]);
}

/** Nur BIENC2 mit passendem Kontext; sonst null. */
export function entschluesselePuffer(daten: Buffer, k: Kontext): Buffer | null {
  const roh = daten.subarray(KOPF2.length);
  const klar = istVerschluesselterPuffer(daten) ? oeffne(v2Schluessel(), roh, k) ?? mitAltSchluessel(roh, k) : null;
  if (klar === null) warne('Eine verschlüsselte Datei');
  return klar;
}

/** Eine BIENC2-Datei, die nur der vorige Schlüssel öffnet, mit dem neuen; sonst undefined. */
export function pufferUmschluesseln(daten: Buffer, k: Kontext): Buffer | undefined {
  if (!istVerschluesselterPuffer(daten) || !altV2Schluessel()) return undefined;
  const roh = daten.subarray(KOPF2.length);
  if (oeffne(v2Schluessel(), roh, k) !== null) return undefined;
  const klar = mitAltSchluessel(roh, k);
  return klar === null ? undefined : verschluesselePuffer(klar, k);
}

/** Für das Umschlüsseln: BIENC2, BIENC1 und unverschlüsselte Dateien. */
export function altenPufferLesen(daten: Buffer, k: Kontext): Buffer | null {
  if (istVerschluesselterPuffer(daten)) return entschluesselePuffer(daten, k);
  if (!beginntMit(daten, KOPF1)) return daten;
  const klar = oeffne(datenSchluessel(), daten.subarray(KOPF1.length), null);
  if (klar === null) warne('Eine verschlüsselte Datei (BIENC1)');
  return klar;
}

export function _vergissSchluessel() { geladen = null; v2 = null; alt = undefined; altV2 = null; }
