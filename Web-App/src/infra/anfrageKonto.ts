import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

/** Für Zähler tief unten, die keinen Request sehen. Gelesen wird erst beim
 * Zählen; die Anmeldung setzt das Konto später auf demselben Objekt. */
const kontext = new AsyncLocalStorage<{ req: Request }>();

export function merkeAnfrage(req: Request, _res: Response, next: NextFunction) {
  kontext.run({ req }, next);
}

export function aktuellesKonto(): { id: number; verwalter: boolean } | null {
  const req = kontext.getStore()?.req as (Request & { apiUser?: { user_id?: number; is_admin?: unknown };
    session?: { userId?: number; isAdmin?: unknown }; tokenUserId?: number }) | undefined;
  if (!req) return null;
  const id = Number(req.apiUser?.user_id ?? req.session?.userId ?? req.tokenUserId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const verwalter = req.apiUser ? !!Number(req.apiUser.is_admin) : !!req.session?.isAdmin;
  return { id, verwalter };
}

export function imNamenVon<T>(req: { apiUser?: unknown; session?: unknown }, f: () => Promise<T>): Promise<T> {
  return kontext.run({ req: req as Request }, f);
}
