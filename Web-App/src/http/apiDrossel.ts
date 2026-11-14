/** Ein Budget je Konto für die angemeldete API: Wer ein Konto hat, kann teure
 * Wege (PDF, Importe, Katalogabrufe) sonst im Takt rufen, bis der Prozess
 * antwortet und niemand mehr. Die Kosten sind gewichtet, damit ein Katalog-
 * Abruf nicht so viel zählt wie ein Leseaufruf; Aufträge haben zusätzlich
 * einen eigenen, kleinen Topf.
 * Gezählt wird im Prozess: Der Web-Prozess ist genau einer (src/http/kontoSchranke.ts
 * sagt dasselbe für gleichzeitige Uploads). Bei mehreren Replicas gälte das
 * Budget je Replica — dann wäre es zu erhöhen, nicht zu vertrauen. */
import type { Request, Response, NextFunction } from 'express';
import { nutzerId } from './nutzerId';
import { sendeFehler } from './httpAntwort';
import { prozessweit } from '../infra/prozessweit';

export const FENSTER_MS = 5 * 60 * 1000;
/** Einheiten je Konto und Fenster; ein Leseaufruf zählt 1. */
export const BUDGET = 600;
/** Auftragsstarts je Konto und Fenster — zusätzlich zum Verbrauch oben. */
export const AUFTRAG_BUDGET = 20;

export const KOSTEN = { normal: 1, abruf: 5, preis: 20, auftrag: 25 } as const;

/** Was einen Auftrag, einen Upload oder einen mehrsekündigen Lauf startet.
 * Bewusst aufgezählt statt „alles unter /admin": Eine neue Route soll hier
 * auffallen und nicht still im Normalbudget landen. */
const AUFTRAEGE: ReadonlyArray<readonly [string, RegExp]> = [
  ['POST', /^\/sets\/partslist-pdf$/],
  ['POST', /^\/sets\/import\/csv$/],
  ['POST', /^\/sets\/add-stream$/],
  ['POST', /^\/parts\/import\/csv$/],
  ['POST', /^\/minifigs\/import\/csv$/],
  ['POST', /^\/wanted\/import\/csv$/],
  ['POST', /^\/wanted-list\/import\/xml$/],
  ['POST', /^\/alerts\/import\/csv$/],
  ['POST', /^\/settings\/import$/],
  ['POST', /^\/vouchers\/pdf$/],
  ['GET', /^\/settings\/export\/data$/],
];

/** Der Katalog fragt Rebrickable je Suche; das Tageskontingent dort ist endlich. */
const ABRUF = /^\/catalog(\/|$)/;

/** Bis zu vier BrickLink-Aufrufe je Anfrage (zwei Zustände, je ein Rückfall), alle aus
 * dem Tageskontingent, das sich ALLE Konten teilen. */
const PREISABRUF: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/wanted\/[^/]+\/preise$/],
  ['GET', /^\/sets\/[^/]+\/price$/],
];

/** Lösen je Anfrage einen Abruf bei Rebrickable, Brickset, einem Barcode-Dienst oder
 * dem Gutschein-Shop aus. Wie die Aufträge aufgezählt: Eine neue Route soll auffallen. */
const FREMDABRUF: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/sets\/info\/[^/]+$/],
  ['GET', /^\/sets\/barcode\/[^/]+$/],
  ['POST', /^\/sets$/],
  ['POST', /^\/sets\/[^/]+\/parts$/],
  ['POST', /^\/sets\/[^/]+\/instructions$/],
  ['POST', /^\/parts$/],
  ['PUT', /^\/parts\/[^/]+\/[^/]+\/color$/],
  ['POST', /^\/minifigs$/],
  ['POST', /^\/wanted\/[^/]+\/[^/]+\/uebernehmen$/],
  ['POST', /^\/vouchers\/[^/]+\/guthaben$/],
];

export function einordnung(methode: string, pfad: string): { kosten: number; auftrag: boolean } {
  const m = methode === 'HEAD' ? 'GET' : methode;
  if (AUFTRAEGE.some(([mm, re]) => mm === m && re.test(pfad))) return { kosten: KOSTEN.auftrag, auftrag: true };
  if (PREISABRUF.some(([mm, re]) => mm === m && re.test(pfad))) return { kosten: KOSTEN.preis, auftrag: false };
  if (FREMDABRUF.some(([mm, re]) => mm === m && re.test(pfad))) return { kosten: KOSTEN.abruf, auftrag: false };
  if (m === 'GET' && ABRUF.test(pfad)) return { kosten: KOSTEN.abruf, auftrag: false };
  return { kosten: KOSTEN.normal, auftrag: false };
}

type Stand = { beginn: number; einheiten: number; auftraege: number };
/** Je Prozess, nicht je Zugang: Die Drossel schützt diesen Prozess (src/infra/prozessweit.ts). */
const staende = () => prozessweit('apiDrossel', () => new Map<number, Stand>());

/** Nur für Tests: ein Zustand, der nicht vom vorigen Lauf abhängt. */
export function drosselLeeren(): void {
  staende().clear();
}

/** Ein abgelaufenes Fenster beginnt neu; abgewiesene Anfragen zählen nicht mit,
 * sonst verlängerte ein Angriff seine eigene Sperre endlos. */
function standFuer(uid: number, jetzt: number): Stand {
  const _staende = staende();
  let s = _staende.get(uid);
  if (!s || jetzt - s.beginn >= FENSTER_MS) {
    s = { beginn: jetzt, einheiten: 0, auftraege: 0 };
    _staende.set(uid, s);
  }
  if (_staende.size > 5000) for (const [id, x] of _staende) if (jetzt - x.beginn >= FENSTER_MS) _staende.delete(id);
  return s;
}

export function pruefeBudget(uid: number, methode: string, pfad: string, jetzt = Date.now()) {
  const { kosten, auftrag } = einordnung(methode, pfad);
  const s = standFuer(uid, jetzt);
  const restSek = Math.max(1, Math.ceil((s.beginn + FENSTER_MS - jetzt) / 1000));
  if (s.einheiten + kosten > BUDGET || (auftrag && s.auftraege >= AUFTRAG_BUDGET))
    return { erlaubt: false as const, kosten, auftrag, restSek, einheiten: s.einheiten, auftraege: s.auftraege };
  s.einheiten += kosten;
  if (auftrag) s.auftraege++;
  return { erlaubt: true as const, kosten, auftrag, restSek, einheiten: s.einheiten, auftraege: s.auftraege };
}

/** Hinter anmeldungAmEingang: Ohne Konto gibt es nichts zu begrenzen, und die
 * Anmeldung hat ihre eigenen Bremsen (src/konto/loginLimiter.ts). */
export function apiDrossel(req: Request, res: Response, next: NextFunction): void {
  const uid = nutzerId(req);
  if (uid === null) {
    next();
    return;
  }
  const r = pruefeBudget(uid, req.method, req.path);
  res.setHeader('RateLimit-Limit', String(BUDGET));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, BUDGET - r.einheiten)));
  res.setHeader('RateLimit-Reset', String(r.restSek));
  if (r.erlaubt) {
    next();
    return;
  }
  res.setHeader('Retry-After', String(r.restSek));
  sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: Math.max(1, Math.ceil(r.restSek / 60)) });
}
