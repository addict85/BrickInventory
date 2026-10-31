/** Was unter /images/ liegt, kommt vom eigenen Ursprung — eine SVG- oder
 * HTML-Datei liefe mit den Rechten der App. Deshalb bestimmt nie die fremde
 * Adresse allein Dateiname, Endung oder Ziel. */
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { hostErlaubt } from '../../infra/fremdeAdressen';

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
  return e in ENDUNG_ZU_TYP ? e : 'jpg';
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
export function ladeBild(
  adresse: string, ziel: string, erlaubteHosts: readonly string[],
  kopfzeilen: Record<string, string> = {}, warnen: (text: string) => void = () => {},
): Promise<boolean> {
  if (!adresse.startsWith('https://') || !hostErlaubt(adresse, erlaubteHosts)) {
    warnen(`Bildadresse nicht erlaubt: ${adresse.slice(0, 80)}`);
    return Promise.resolve(false);
  }
  // Eindeutig je Abruf: Zwei gleichzeitige Downloads schrieben sonst in
  // dieselbe Zwischendatei.
  const zwischen = `${ziel}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.teil`;
  return new Promise<boolean>(fertig => {
    let erledigt = false;
    const ende = (ok: boolean) => {
      if (erledigt) return;
      erledigt = true;
      if (!ok) fs.rm(zwischen, { force: true }, () => fertig(false));
      else fs.rename(zwischen, ziel, e => fertig(!e));
    };
    const req = https.get(adresse, { family: 4, headers: kopfzeilen }, r => {
      if (r.statusCode !== 200) { r.resume(); warnen(`HTTP ${r.statusCode}: ${adresse.slice(0, 80)}`); return ende(false); }
      if (!bildTypErlaubt(r.headers['content-type'])) {
        r.resume(); warnen(`kein Bild (${r.headers['content-type']}): ${adresse.slice(0, 80)}`); return ende(false);
      }
      let gelesen = 0;
      const out = fs.createWriteStream(zwischen);
      r.on('data', (d: Buffer) => {
        gelesen += d.length;
        if (gelesen > BILD_MAX_BYTES) { warnen(`Bild zu gross: ${adresse.slice(0, 80)}`); r.destroy(); out.destroy(); ende(false); }
      });
      r.pipe(out);
      out.on('finish', () => ende(true));
      out.on('error', () => ende(false));
      r.on('error', () => ende(false));
    });
    req.on('error', () => ende(false));
    req.setTimeout(15000, () => { req.destroy(); ende(false); });
  });
}
