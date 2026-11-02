/** Was unter /images/ liegt, kommt vom eigenen Ursprung — eine SVG- oder
 * HTML-Datei liefe mit den Rechten der App. Deshalb bestimmt nie die fremde
 * Adresse allein Dateiname, Endung oder Ziel. */
import crypto from 'crypto';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { oeffneHttps, AbrufFehler } from '../../infra/abruf';

/** Bewusst ohne SVG. */
const ENDUNG_ZU_TYP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

export const BILD_MAX_BYTES = 10 * 1024 * 1024;

/** Sonst jpg. */
export function bildEndung(adresse: string): string {
  let pfad = '';
  try { pfad = new URL(adresse).pathname; } catch { return 'jpg'; }
  const e = (pfad.split('.').pop() ?? '').toLowerCase();
  return Object.hasOwn(ENDUNG_ZU_TYP, e) ? e : 'jpg';
}

export function bildTypErlaubt(contentType: string | undefined): boolean {
  const typ = String(contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return Object.values(ENDUNG_ZU_TYP).includes(typ);
}

/** @returns null, wenn er einen Pfad bilden könnte — dann wird nicht gespeichert */
export function dateiTeil(wert: unknown): string | null {
  const s = String(wert ?? '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) && !s.includes('..') ? s : null;
}

/** Nur, wenn er wirklich direkt im Ordner liegt. */
export function zielImOrdner(ordner: string, datei: string): string | null {
  const ziel = path.resolve(ordner, datei);
  return path.dirname(ziel) === path.resolve(ordner) ? ziel : null;
}

/** Erst in eine Zwischendatei, damit ein abgebrochener Download nicht später
 * als „schon vorhanden" gilt.
 * @returns ob das Bild jetzt unter `ziel` liegt */
export async function ladeBild(
  adresse: string, ziel: string, erlaubteHosts: readonly string[],
  kopfzeilen: Record<string, string> = {}, warnen: (text: string) => void = () => {},
): Promise<boolean> {
  let a;
  try { a = await oeffneHttps(adresse, { hosts: erlaubteHosts, maxBytes: BILD_MAX_BYTES, zeitlimitMs: 30_000, kopfzeilen }); }
  catch (e) { warnen(e instanceof Error ? e.message : String(e)); return false; }
  if (a.status !== 200) { a.verwerfen(); warnen(`HTTP ${a.status}: ${adresse.slice(0, 80)}`); return false; }
  if (!bildTypErlaubt(a.kopf['content-type'])) {
    a.verwerfen(); warnen(`kein Bild (${a.kopf['content-type']}): ${adresse.slice(0, 80)}`); return false;
  }
  // Eindeutig je Abruf: Zwei gleichzeitige Downloads schrieben sonst in
  // dieselbe Zwischendatei.
  const zwischen = `${ziel}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.teil`;
  try {
    await pipeline(a.strom(), fs.createWriteStream(zwischen));
    await fs.promises.rename(zwischen, ziel);
    return true;
  } catch (e) {
    if (e instanceof AbrufFehler && e.grund === 'zu-gross') warnen(`Bild zu gross: ${adresse.slice(0, 80)}`);
    await fs.promises.rm(zwischen, { force: true });
    return false;
  }
}
