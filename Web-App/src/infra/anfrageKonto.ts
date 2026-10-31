import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

/**
 * Welches Konto die laufende Arbeit ausgelöst hat — für Zähler tief unten
 * (src/katalog/apiKontingent.ts), die sonst keinen Request sehen. Gelesen wird erst
 * beim Zählen, deshalb reicht es, den Request zu merken: Die Anmeldung setzt
 * apiUser bzw. session später, auf demselben Objekt.
 */
const kontext = new AsyncLocalStorage<{ req: Request }>();

export function merkeAnfrage(req: Request, _res: Response, next: NextFunction) {
  kontext.run({ req }, next);
}

/** Konto der laufenden Anfrage, oder null (Hintergrundjob, unangemeldet). */
export function aktuellesKonto(): { id: number; verwalter: boolean } | null {
  const req = kontext.getStore()?.req as (Request & { apiUser?: { user_id?: number; is_admin?: unknown };
    session?: { userId?: number; isAdmin?: unknown }; tokenUserId?: number }) | undefined;
  if (!req) return null;
  const id = Number(req.apiUser?.user_id ?? req.session?.userId ?? req.tokenUserId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const verwalter = req.apiUser ? !!Number(req.apiUser.is_admin) : !!req.session?.isAdmin;
  return { id, verwalter };
}

/** Für Tests und Jobs, die bewusst im Namen eines Kontos arbeiten. */
export function imNamenVon<T>(req: { apiUser?: unknown; session?: unknown }, f: () => Promise<T>): Promise<T> {
  return kontext.run({ req: req as Request }, f);
}
