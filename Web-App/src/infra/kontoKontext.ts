/** Der Aufrufrahmen, der einzige Kanal über AsyncLocalStorage: wer fragt (Zeilenschutz je Transaktion),
 * Merker für die Wachen der Datenbank, Commit-Begleiter, Anfragekennung (docs/architektur.md). */
import { AsyncLocalStorage } from 'node:async_hooks';

/** Was von einer Anfrage das Konto verrät: Sitzung, Token oder Auftrag im Namen
 * eines Kontos. Bewusst ohne Express, damit Zähler tief unten es lesen können. */
export interface AccountSource {
  apiUser?: { user_id?: number; is_admin?: boolean } | undefined;
  session?: { userId?: number; isAdmin?: unknown } | undefined;
  tokenUserId?: number | undefined;
}

/** Was die Wachen über die offene Transaktion wissen (db/transaktion.ts füllt es): Der Wächter
 * gegen Ersatzwerte reist mit ihr im Rahmen, nicht als Zustand des Prozesses. */
export interface PathTransaction {
  /** Lässt dieser Fehler sie verdorben zurück? Ein Sicherungspunkt, der ihn auffing, nicht. */
  verdirbt(e: unknown): boolean;
  /** In Tests wirft auch ein Fehler ausserhalb der Datenbank, damit die Regel greift. */
  readonly streng: boolean;
}

interface Rahmen {
  /** Gelesen erst beim Fragen: Die Anmeldung setzt das Konto später auf demselben Objekt. */
  quelle: AccountSource | null;
  system: string | null;
  web: boolean;
  /** Die offene Transaktion dieses Aufrufpfads: nur für Wachen, nie ein Weg zu ihr. */
  transaktion: PathTransaction | null;
  companion: unknown;
  rid: string | null;
}
const LEER: Rahmen = { quelle: null, system: null, web: false, transaktion: null, companion: null, rid: null };
const rahmen = new AsyncLocalStorage<Rahmen>();
const jetzt = (): Rahmen => rahmen.getStore() ?? LEER;
const withFrame = <T>(teil: Partial<Rahmen>, f: () => T): T => rahmen.run({ ...jetzt(), ...teil }, f);

export function currentAccount(): { id: number; verwalter: boolean } | null {
  const q = jetzt().quelle;
  if (!q) return null;
  const id = Number(q.apiUser?.user_id ?? q.session?.userId ?? q.tokenUserId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const verwalter = q.apiUser ? !!q.apiUser.is_admin : !!q.session?.isAdmin;
  return { id, verwalter };
}

/** Arbeit über Kontogrenzen: Abfragen gehen dann über die Systemrolle (BYPASSRLS, Migration 0112).
 * Der Grund steht am Aufruf, auffindbar per `inSystemContext(`. */
export function inSystemContext<T>(grund: string, f: () => T): T {
  return withFrame({ system: grund }, f);
}

/** Im Namen eines Kontos (Auftrag): ohne geerbten Systemrahmen und nicht als HTTP-Anfrage. */
export function asRequest<T>(quelle: AccountSource, f: () => T): T {
  return withFrame({ system: null, web: false, quelle }, f);
}

/** Eine HTTP-Anfrage erbt keinen Systemrahmen; ihren eigenen trägt die Web-Systemrolle (db/database.ts). */
export function asWebRequest<T>(quelle: AccountSource, f: () => T): T {
  return withFrame({ system: null, web: true, quelle }, f);
}

export function rowsContext(): { system: boolean; web: boolean; konto: number | null } {
  const r = jetzt();
  return { system: !!r.system, web: r.web, konto: currentAccount()?.id ?? null };
}

/** Ein Dienst für ein anderes Konto als das des Zeilenschutzes sähe still weniger; fremde über asRequest. */
export class ForeignAccount extends Error {
  constructor(uid: number, konto: number) {
    super(`Dienst für Konto ${uid} unter dem Zeilenschutz von Konto ${konto}`);
  }
}

export function checkRequester(uid: number): void {
  if (jetzt().system) return;
  // Ohne Konto im Rahmen (Start, Anmeldung davor) filtert kein Zeilenschutz still mit.
  const konto = currentAccount()?.id;
  if (konto !== undefined && konto !== uid) throw new ForeignAccount(uid, konto);
}

/** Für die Wachen der Datenbank (db/transaktion.ts), den Commit-Begleiter der Idempotenz und das Protokoll. */
export function inTransactionPath<T>(transaktion: PathTransaction, f: () => T): T {
  return withFrame({ transaktion }, f);
}
export function transactionOfPath(): PathTransaction | null {
  return jetzt().transaktion;
}

export function withCompanion<T>(companion: unknown, f: () => T): T {
  return withFrame({ companion }, f);
}
export function companionOfPath(): unknown {
  return jetzt().companion;
}

export const requestContext = {
  run: <T>(w: { rid: string }, f: () => T): T => withFrame({ rid: w.rid }, f),
  getStore: (): { rid: string } | undefined => {
    const rid = jetzt().rid;
    return rid === null ? undefined : { rid };
  },
};
