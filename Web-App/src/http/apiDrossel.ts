/** Ein Budget je Konto für die angemeldete API, gewichtet nach Kosten (PDF, Importe, Katalog), damit
 * ein Konto teure Wege nicht im Takt rufen kann. Gezählt im Prozess: Es gibt genau einen Web-Prozess. */
import type { Request, Response, NextFunction } from 'express';
import { nutzerId } from './nutzerId';
import { sendeFehler } from './httpAntwort';
import { prozessweit } from '../infra/prozessweit';
import { schluesselFuerAnfrage, type Schluessel } from '../vertrag';

export const FENSTER_MS = 5 * 60 * 1000;
/** Einheiten je Konto und Fenster; ein Leseaufruf zählt 1. */
export const BUDGET = 600;
/** Auftragsstarts je Konto und Fenster — zusätzlich zum Verbrauch oben. */
export const AUFTRAG_BUDGET = 20;

export const KOSTEN = { normal: 1, abruf: 5, preis: 20, auftrag: 25 } as const;

/** Was einen Auftrag, einen Upload oder einen mehrsekündigen Lauf startet.
 * Bewusst aufgezählt statt „alles unter /admin": Eine neue Route soll hier
 * auffallen und nicht still im Normalbudget landen. Vertragsschlüssel statt Pfadmuster:
 * Eingeordnet wird die Route, die Express finden wird, nicht eine Schreibung davon. */
const AUFTRAEGE: ReadonlySet<Schluessel> = new Set<Schluessel>([
  'POST /api/v1/sets/partslist-pdf',
  'POST /api/v1/sets/import/csv',
  'POST /api/v1/sets/add-stream',
  'POST /api/v1/parts/import/csv',
  'POST /api/v1/minifigs/import/csv',
  'POST /api/v1/wanted/import/csv',
  'POST /api/v1/wanted-list/import/xml',
  'POST /api/v1/alerts/import/csv',
  'POST /api/v1/settings/import',
  'POST /api/v1/vouchers/pdf',
  'GET /api/v1/settings/export/data',
]);

/** Bis zu vier BrickLink-Aufrufe je Anfrage (zwei Zustände, je ein Rückfall), alle aus
 * dem Tageskontingent, das sich ALLE Konten teilen. */
const PREISABRUF: ReadonlySet<Schluessel> = new Set<Schluessel>([
  'GET /api/v1/wanted/:setNumber/preise',
  'GET /api/v1/sets/:setNumber/price',
]);

/** Lösen je Anfrage einen Abruf bei Rebrickable, Brickset, einem Barcode-Dienst oder
 * dem Gutschein-Shop aus. Der Katalog fragt Rebrickable je Suche; das Tageskontingent dort ist endlich. */
const FREMDABRUF: ReadonlySet<Schluessel> = new Set<Schluessel>([
  'GET /api/v1/sets/info/:setNumber',
  'GET /api/v1/sets/barcode/:barcode',
  'POST /api/v1/sets',
  'POST /api/v1/sets/:setNumber/parts',
  'POST /api/v1/sets/:setNumber/instructions',
  'POST /api/v1/parts',
  'PUT /api/v1/parts/:partNumber/:colorId/color',
  'POST /api/v1/minifigs',
  'POST /api/v1/wanted/:setNumber/:condition/uebernehmen',
  'POST /api/v1/vouchers/:id/guthaben',
]);

/** @param pfad relativ zu /api/v1, wie apiDrossel ihn dort sieht */
export function einordnung(methode: string, pfad: string): { kosten: number; auftrag: boolean } {
  const k = schluesselFuerAnfrage(methode === 'HEAD' ? 'GET' : methode, `/api/v1${pfad}`);
  if (!k) return { kosten: KOSTEN.normal, auftrag: false };
  if (AUFTRAEGE.has(k)) return { kosten: KOSTEN.auftrag, auftrag: true };
  if (PREISABRUF.has(k)) return { kosten: KOSTEN.preis, auftrag: false };
  if (FREMDABRUF.has(k) || k.startsWith('GET /api/v1/catalog')) return { kosten: KOSTEN.abruf, auftrag: false };
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
  sendeFehler(req, res, 'zu_viele', 'zu_viele_anfragen', { minuten: Math.max(1, Math.ceil(r.restSek / 60)) });
}
