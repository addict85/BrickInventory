import { AsyncLocalStorage } from 'node:async_hooks';

/** Was von einer Anfrage das Konto verrät: Sitzung, Token oder Auftrag im Namen
 * eines Kontos. Bewusst ohne Express, damit Zähler tief unten es lesen können. */
export interface KontoQuelle {
  apiUser?: { user_id?: number; is_admin?: boolean } | undefined;
  session?: { userId?: number; isAdmin?: unknown } | undefined;
  tokenUserId?: number | undefined;
}

/** Gelesen wird erst beim Zählen; die Anmeldung setzt das Konto später auf demselben Objekt. */
const kontext = new AsyncLocalStorage<{ quelle: KontoQuelle }>();

export function aktuellesKonto(): { id: number; verwalter: boolean } | null {
  const q = kontext.getStore()?.quelle;
  if (!q) return null;
  const id = Number(q.apiUser?.user_id ?? q.session?.userId ?? q.tokenUserId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const verwalter = q.apiUser ? !!q.apiUser.is_admin : !!q.session?.isAdmin;
  return { id, verwalter };
}

export function imNamenVon<T>(quelle: KontoQuelle, f: () => T): T {
  return kontext.run({ quelle }, f);
}

/** Arbeit über Kontogrenzen: Abfragen gehen dann über die Systemrolle (BYPASSRLS, Migration 0112).
 * Der Grund steht am Aufruf, auffindbar per `imSystemkontext(`. */
const systemRahmen = new AsyncLocalStorage<string | null>();

export function imSystemkontext<T>(grund: string, f: () => T): T {
  return systemRahmen.run(grund, f);
}

/** Eine HTTP-Anfrage erbt keinen Systemrahmen, auch wenn Web und Jobs in einem Prozess laufen. */
export function alsAnfrage<T>(quelle: KontoQuelle, f: () => T): T {
  return systemRahmen.run(null, () => kontext.run({ quelle }, f));
}

/** Was die Datenbankschicht je Transaktion setzt. */
export function zeilenKontext(): { system: boolean; konto: number | null } {
  return { system: !!systemRahmen.getStore(), konto: aktuellesKonto()?.id ?? null };
}
