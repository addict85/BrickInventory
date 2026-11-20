/** Der Stand einer Transaktion: Kontext des Zeilenschutzes, Sicherungspunkte, Nachzügler
 * und Rahmenwechsel. createDb() (database.ts) öffnet sie; wer in ihr fragt, bekommt
 * ihren Griff (`tx`, `tx.db`) ausdrücklich gereicht. */
import type { Pool, PoolClient } from 'pg';
import type { DbInterface } from './types';
import {
  companionOfPath,
  withCompanion,
  transactionOfPath,
  rowsContext,
  type PathTransaction,
} from '../src/infra/accountContext';

/** `offen` schützt vor Nachzüglern nach COMMIT; `db` ist der Zugang, der sie öffnete. */
export type TxStand = PathTransaction & {
  client: PoolClient;
  offen: boolean;
  db: object;
  pool: Pool;
  innerster: string | null;
  kontext: string;
};

/** Die offene Transaktion dieses Aufrufpfads, für die Wachen (UnboundQuery, Ersatzwert). */
export function runningTx(): TxStand | null {
  const t = transactionOfPath();
  return t && 'client' in t ? (t as TxStand) : null;
}

/** Für den Zeilenschutz (Migration 0111): wer gerade fragt, nur bis zum Ende
 * der Transaktion. Ein Wert auf Sitzungsebene bliebe an der Pool-Verbindung
 * hängen und gälte in der nächsten Anfrage eines anderen Kontos. Die Konto-ID
 * ist eine geprüfte ganze Zahl und darf deshalb ins SQL. Den Systemrahmen
 * trägt die Rolle der Verbindung (Migration 0112), keine Einstellung. */
export function contextSql(): string {
  const { system, konto } = rowsContext();
  if (system || konto === null) return '';
  return `SELECT set_config('app.konto', '${konto}', true)`;
}
const CONTEXT_EMPTY = "SELECT set_config('app.konto', '', true)";

/** Wechselt das Konto mitten in der Transaktion (asRequest), folgt die Einstellung. */
export async function contextSync(stand: TxStand): Promise<void> {
  const soll = contextSql();
  if (soll === stand.kontext) return;
  await stand.client.query(soll || CONTEXT_EMPTY);
  stand.kontext = soll;
}

/** Was der Rumpf einer Transaktion bekommt: ihre Abfragen und `db`, einen ganzen Zugang
 * über ihrer Verbindung, aus dem der Kontext `t` gebaut wird (src/infra/area.ts). */
export interface TxHandleOf<D> extends DbInterface {
  readonly db: D;
}

/** Die Abfragen über die Verbindung der Transaktion; `pruefe` wacht über den Rahmen. */
export function txQueries(stand: TxStand, pruefe: () => void): DbInterface {
  const q = async (sql: string, p?: unknown[]) => {
    openStill(stand);
    pruefe();
    await contextSync(stand);
    return stand.client.query(sql, p);
  };
  return {
    all: <T = unknown>(sql: string, p?: unknown[]) => q(sql, p).then(r => r.rows as T[]),
    get: <T = unknown>(sql: string, p?: unknown[]) => q(sql, p).then(r => r.rows[0] as T | undefined),
    run: (sql: string, p?: unknown[]) => q(sql, p).then(r => ({ changes: r.rowCount ?? 0 })),
    exec: (sql: string) => q(sql).then(() => undefined),
  };
}

/** Läuft vor dem COMMIT jeder äussersten Transaktion dieses Aufrufpfads mit,
 * in ihr: Was er schreibt, gilt genau dann, wenn ihre Wirkung gilt. */
type CommitCompanion = (tx: DbInterface) => Promise<void>;
export function commitCompanion(): CommitCompanion | null {
  return (companionOfPath() as CommitCompanion | null) ?? null;
}
export function withCommitCompanion<T>(companion: CommitCompanion, work: () => T): T {
  return withCompanion(companion, work);
}

/** Die Verbindung einer beendeten Transaktion ist schon zurück im Pool: Ein Nachzügler
 * (Promise.all bricht beim ersten Fehler ab, die anderen laufen weiter) verdürbe dort
 * die Transaktion eines Fremden. */
export class TransactionEnded extends Error {
  constructor() {
    super('Abfrage nach dem Ende ihrer Transaktion (Nachzügler aus Promise.all?)');
  }
}
function openStill(stand: TxStand): void {
  if (!stand.offen) throw new TransactionEnded();
}

export class BesideTheTransaction extends Error {
  constructor(transactionInSystemrahmen: boolean) {
    super(
      transactionInSystemrahmen
        ? 'Abfrage ohne Systemrahmen in einer Transaktion des Systemrahmens: Sie liefe über eine zweite Verbindung neben ihr.'
        : 'Systemrahmen (imSystemkontext) mitten in einer Transaktion: Die Abfrage liefe über eine zweite ' +
            'Verbindung neben ihr. Den Rahmen vor der Transaktion betreten.',
    );
  }
}

/** Eine Abfrage über den ungebundenen Zugang, während in diesem Aufrufpfad eine
 * Transaktion offen ist: Sie gehört entweder in die Transaktion (über `t`) oder
 * vor bzw. hinter sie. Still umgeleitet hiesse, dass der Aufrufort nicht sagt, was gilt. */
export class UnboundQuery extends Error {
  constructor() {
    super(
      'Abfrage über den ungebundenen Zugang (k/db) mitten in einer Transaktion: über den Kontext ' +
        'der Transaktion (t) fragen oder ausserhalb von ihr.',
    );
  }
}

export class ConcurrentSavepoint extends Error {
  constructor(offen: string) {
    super(
      `Innere Transaktion, während ${offen} derselben Transaktion noch läuft (Promise.all über ` +
        'db.transaction?): Sicherungspunkte einer Verbindung sind ein Stapel, nacheinander ausführen.',
    );
  }
}

/** Innerhalb einer Transaktion ein Sicherungspunkt: Scheitert der innere Teil
 * und fängt der Aufrufer das, bleibt die äussere Transaktion benutzbar. Zwei
 * gleichzeitige teilten sich eine Verbindung; das ROLLBACK TO des einen nähme
 * die Arbeit des anderen mit. Deshalb beginnt jeder im innersten offenen, und
 * welcher das ist, sagt der Griff, über den er gerufen wird (`rahmen`). */
export function innerTransaction<T>(
  stand: TxStand,
  rahmen: string | null,
  nummer: number,
  fn: (name: string) => Promise<T>,
): Promise<T> {
  if (stand.innerster !== rahmen) return Promise.reject(new ConcurrentSavepoint(stand.innerster ?? ''));
  const name = `sp_${nummer}`;
  stand.innerster = name;
  return (async () => {
    const { client } = stand;
    // ROLLBACK TO nimmt auch ein set_config() aus dem Sicherungspunkt zurück.
    const contextBefore = stand.kontext;
    try {
      openStill(stand);
      await client.query(`SAVEPOINT ${name}`);
      try {
        const r = await fn(name);
        openStill(stand);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return r;
      } catch (e) {
        if (!stand.offen) throw e;
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        stand.kontext = contextBefore;
        if (e !== null && typeof e === 'object') fromSavepointCaught.add(e);
        throw e;
      }
    } finally {
      stand.innerster = rahmen;
    }
  })();
}

/** Nach ROLLBACK TO SAVEPOINT ist die Transaktion wieder benutzbar: Wer diesen
 * Fehler auffängt und einen Ersatz liefert, verdeckt nichts. */
const fromSavepointCaught = new WeakSet<object>();

/** Der Stand einer neuen Transaktion; er ist zugleich ihr Wächter gegen Ersatzwerte. */
export function newTxStatus(t: Omit<TxStand, 'verdirbt' | 'offen' | 'innerster' | 'kontext'>): TxStand {
  const stand: TxStand = {
    ...t,
    offen: true,
    innerster: null,
    kontext: '',
    verdirbt: e => stand.offen && !(e !== null && typeof e === 'object' && fromSavepointCaught.has(e)),
  };
  return stand;
}
