/** Der Aufrufrahmen, der einzige Kanal über AsyncLocalStorage: wer fragt (Zeilenschutz je Transaktion),
 * Merker für die Wachen der Datenbank, Commit-Begleiter, Anfragekennung (docs/architektur.md). */
import { AsyncLocalStorage } from 'node:async_hooks';

/** Was von einer Anfrage das Konto verrät: Sitzung, Token oder Auftrag im Namen
 * eines Kontos. Bewusst ohne Express, damit Zähler tief unten es lesen können. */
export interface KontoQuelle {
  apiUser?: { user_id?: number; is_admin?: boolean } | undefined;
  session?: { userId?: number; isAdmin?: unknown } | undefined;
  tokenUserId?: number | undefined;
}

interface Rahmen {
  /** Gelesen erst beim Fragen: Die Anmeldung setzt das Konto später auf demselben Objekt. */
  quelle: KontoQuelle | null;
  system: string | null;
  /** Die offene Transaktion dieses Aufrufpfads: nur für Wachen, nie ein Weg zu ihr. */
  transaktion: object | null;
  begleiter: unknown;
  rid: string | null;
}
const LEER: Rahmen = { quelle: null, system: null, transaktion: null, begleiter: null, rid: null };
const rahmen = new AsyncLocalStorage<Rahmen>();
const jetzt = (): Rahmen => rahmen.getStore() ?? LEER;
const mitRahmen = <T>(teil: Partial<Rahmen>, f: () => T): T => rahmen.run({ ...jetzt(), ...teil }, f);

export function aktuellesKonto(): { id: number; verwalter: boolean } | null {
  const q = jetzt().quelle;
  if (!q) return null;
  const id = Number(q.apiUser?.user_id ?? q.session?.userId ?? q.tokenUserId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const verwalter = q.apiUser ? !!q.apiUser.is_admin : !!q.session?.isAdmin;
  return { id, verwalter };
}

/** Arbeit über Kontogrenzen: Abfragen gehen dann über die Systemrolle (BYPASSRLS, Migration 0112).
 * Der Grund steht am Aufruf, auffindbar per `imSystemkontext(`. */
export function imSystemkontext<T>(grund: string, f: () => T): T {
  return mitRahmen({ system: grund }, f);
}

/** Eine HTTP-Anfrage erbt keinen Systemrahmen, auch wenn Web und Jobs in einem Prozess laufen. */
export function alsAnfrage<T>(quelle: KontoQuelle, f: () => T): T {
  return mitRahmen({ system: null, quelle }, f);
}

export function zeilenKontext(): { system: boolean; konto: number | null } {
  return { system: !!jetzt().system, konto: aktuellesKonto()?.id ?? null };
}

/** Ein Dienst für ein anderes Konto als das des Zeilenschutzes sähe still weniger; fremde über alsAnfrage. */
export class FremdesKonto extends Error {
  constructor(uid: number, konto: number) {
    super(`Dienst für Konto ${uid} unter dem Zeilenschutz von Konto ${konto}`);
  }
}

export function pruefeAnfragender(uid: number): void {
  if (jetzt().system) return;
  // Ohne Konto im Rahmen (Start, Anmeldung davor) filtert kein Zeilenschutz still mit.
  const konto = aktuellesKonto()?.id;
  if (konto !== undefined && konto !== uid) throw new FremdesKonto(uid, konto);
}

/** Für die Wachen der Datenbank (db/transaktion.ts), den Commit-Begleiter der Idempotenz und das Protokoll. */
export function inTransaktionsPfad<T>(transaktion: object, f: () => T): T {
  return mitRahmen({ transaktion }, f);
}
export function transaktionDesPfads(): object | null {
  return jetzt().transaktion;
}

export function mitBegleiter<T>(begleiter: unknown, f: () => T): T {
  return mitRahmen({ begleiter }, f);
}
export function begleiterDesPfads(): unknown {
  return jetzt().begleiter;
}

export const anfrageKontext = {
  run: <T>(w: { rid: string }, f: () => T): T => mitRahmen({ rid: w.rid }, f),
  getStore: (): { rid: string } | undefined => {
    const rid = jetzt().rid;
    return rid === null ? undefined : { rid };
  },
};
