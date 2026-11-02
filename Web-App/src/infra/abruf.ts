/** Der eine Weg nach draussen. Ein Wurf aus einem Antwort-Rückruf ist eine
 * uncaughtException und beendet den Server; deshalb ruft nur diese Datei
 * https.get, und jeder Fehler wird hier zur Ablehnung. */
import https from 'https';
import { PassThrough, type Readable } from 'stream';
import type { IncomingHttpHeaders, IncomingMessage, ClientRequest } from 'http';
import { hostErlaubt, naechsteUmleitung, UMLEITUNGS_GRENZE } from './fremdeAdressen';

export type AbrufGrund = 'adresse' | 'umleitung' | 'zu-gross' | 'zeitlimit' | 'netz';

export class AbrufFehler extends Error {
  readonly grund: AbrufGrund;
  /** Wie in clients/abrufFehler.ts: ein erneuter Versuch kann gelingen. */
  readonly isTransient: boolean;
  constructor(grund: AbrufGrund, text: string, ursache?: unknown) {
    super(text, ursache === undefined ? undefined : { cause: ursache });
    this.name = 'AbrufFehler';
    this.grund = grund;
    this.isTransient = grund === 'zeitlimit' || grund === 'netz';
  }
}

export interface AbrufOptionen {
  /** Gilt für die erste Adresse und für jeden Sprung. */
  hosts: readonly string[];
  maxBytes: number;
  /** Gesamtfrist vom ersten Sprung bis zum letzten Byte. */
  zeitlimitMs: number;
  kopfzeilen?: Record<string, string>;
  umleitungen?: number;
  agent?: https.Agent;
}

export interface AbrufKopf {
  status: number;
  kopf: IncomingHttpHeaders;
  /** Die Adresse nach allen Umleitungen. */
  url: string;
}

export interface AbrufAntwort extends AbrufKopf { koerper: Buffer }

export interface AbrufStrom extends AbrufKopf {
  /** Der Körper, begrenzt auf maxBytes; darüber endet er mit AbrufFehler. */
  strom(): Readable;
  verwerfen(): void;
}

const UMLEITUNG = new Set([301, 302, 303, 307, 308]);
/** Ohne Anfrageteil: Dort stehen API-Schlüssel (Brickset), und Fehlertexte landen im Log. */
function adresseKurz(u: string): string {
  try { const x = new URL(u); return (x.origin + x.pathname).slice(0, 120); } catch { return '(unlesbare Adresse)'; }
}

/** Fremder Antworttext fürs Log: einzeilig und kurz, damit er keine Zeilen fälscht. */
export function auszug(text: unknown, n = 120): string {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n);
}

interface Lauf { antwort: IncomingMessage; url: string; frist: NodeJS.Timeout; abbrechen: (f: AbrufFehler) => void }

function laufe(start: string, o: AbrufOptionen): Promise<Lauf> {
  return new Promise((fertig, scheitern) => {
    let req: ClientRequest | null = null;
    let antwort: IncomingMessage | null = null;
    let erledigt = false;
    const abbrechen = (f: AbrufFehler) => {
      clearTimeout(frist);
      if (!erledigt) { erledigt = true; scheitern(f); }
      antwort?.destroy?.(f);
      req?.destroy?.();
    };
    const frist = setTimeout(() => abbrechen(new AbrufFehler('zeitlimit',
      `Zeitlimit ${o.zeitlimitMs} ms: ${adresseKurz(start)}`)), o.zeitlimitMs);
    frist.unref?.();

    const sprung = (u: string, kopf: Record<string, string>, rest: number) => {
      if (!u.startsWith('https://') || !hostErlaubt(u, o.hosts))
        return abbrechen(new AbrufFehler('adresse', `Adresse nicht erlaubt: ${adresseKurz(u)}`));
      try {
        req = https.get(u, { family: 4, headers: kopf, ...(o.agent ? { agent: o.agent } : {}) }, r => {
          if (erledigt) { r.resume?.(); return; }
          const status = r.statusCode ?? 0;
          if (UMLEITUNG.has(status) && (o.umleitungen ?? UMLEITUNGS_GRENZE) > 0) {
            r.resume?.();
            if (rest <= 0) return abbrechen(new AbrufFehler('umleitung', `Zu viele Umleitungen: ${adresseKurz(start)}`));
            const weiter = naechsteUmleitung(u, r.headers?.location, kopf, o.hosts);
            if (!weiter) return abbrechen(new AbrufFehler('umleitung',
              `Umleitung ${status} nicht befolgbar (fehlend, kein https oder fremder Host): ${adresseKurz(u)}`));
            return sprung(weiter.url, weiter.kopfzeilen, rest - 1);
          }
          const laenge = Number(r.headers?.['content-length']);
          if (laenge > o.maxBytes) {
            r.resume?.();
            return abbrechen(new AbrufFehler('zu-gross', `Antwort über ${o.maxBytes} Byte: ${adresseKurz(u)}`));
          }
          antwort = r;
          erledigt = true;
          fertig({ antwort: r, url: u, frist, abbrechen });
        });
        req.on('error', (e: Error) => abbrechen(e instanceof AbrufFehler ? e
          : new AbrufFehler('netz', `${(e as NodeJS.ErrnoException).code || e.message}: ${adresseKurz(u)}`, e)));
      } catch (e) {
        abbrechen(new AbrufFehler('adresse', `Abruf nicht möglich: ${adresseKurz(u)}`, e));
      }
    };
    sprung(start, o.kopfzeilen ?? {}, o.umleitungen ?? UMLEITUNGS_GRENZE);
  });
}

/** Ganze Antwort in den Speicher — für API-Antworten und kleine Bilder. */
export async function holeHttps(url: string, o: AbrufOptionen): Promise<AbrufAntwort> {
  const { antwort: r, url: ende, frist, abbrechen } = await laufe(url, o);
  return new Promise((fertig, scheitern) => {
    const teile: Buffer[] = [];
    let n = 0, aus = false;
    const fehler = (f: AbrufFehler) => { if (!aus) { aus = true; scheitern(f); } abbrechen(f); };
    r.on('data', (d: Buffer | string) => {
      const b = typeof d === 'string' ? Buffer.from(d) : d;
      n += b.length;
      if (n > o.maxBytes) return fehler(new AbrufFehler('zu-gross', `Antwort über ${o.maxBytes} Byte: ${adresseKurz(ende)}`));
      teile.push(b);
    });
    r.on('end', () => {
      clearTimeout(frist);
      if (!aus) { aus = true; fertig({ status: r.statusCode ?? 0, kopf: r.headers ?? {}, url: ende, koerper: Buffer.concat(teile) }); }
    });
    r.on('error', (e: Error) => fehler(e instanceof AbrufFehler ? e : new AbrufFehler('netz', `${e.message}: ${adresseKurz(ende)}`, e)));
  });
}

/** Nur der Kopf; der Körper als begrenzter Strom — für Dateien und den Bild-Proxy. */
export async function oeffneHttps(url: string, o: AbrufOptionen): Promise<AbrufStrom> {
  const { antwort: r, url: ende, frist, abbrechen } = await laufe(url, o);
  return {
    status: r.statusCode ?? 0, kopf: r.headers ?? {}, url: ende,
    verwerfen: () => { clearTimeout(frist); r.resume?.(); },
    strom: () => {
      const aus = new PassThrough();
      let n = 0;
      r.on('data', (d: Buffer) => {
        n += d.length;
        if (n > o.maxBytes) {
          const f = new AbrufFehler('zu-gross', `Antwort über ${o.maxBytes} Byte: ${adresseKurz(ende)}`);
          aus.destroy(f); abbrechen(f);
        }
      });
      r.on('end', () => clearTimeout(frist));
      r.on('error', (e: Error) => { clearTimeout(frist); aus.destroy(e); });
      aus.on('close', () => { if (!r.complete) abbrechen(new AbrufFehler('netz', `Abgebrochen: ${adresseKurz(ende)}`)); });
      r.pipe(aus);
      return aus;
    },
  };
}
