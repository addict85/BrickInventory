/** Der Stand einer Transaktion je Aufrufpfad: Kontext des Zeilenschutzes,
 * Sicherungspunkte, Nachzügler und Rahmenwechsel. erzeugeDb() (database.ts) öffnet sie. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';
import type { DbSchnittstelle } from './typen';
import { setzeTransaktionsWaechter } from '../src/infra/fehler';
import { konfig } from '../src/infra/konfig';
import { zeilenKontext } from '../src/infra/kontoKontext';

/** Die laufende Transaktion dieses Aufrufpfads: all/get/run/exec gehen dann
 * über ihre Verbindung, auch aus Repositories ohne tx-Parameter. Sonst läse
 * ein Dienst mitten in der Transaktion über eine zweite Verbindung ausserhalb
 * ihres Stands. `offen` schützt vor Nachzüglern nach COMMIT. */
export type TxStand = {
  client: PoolClient;
  offen: boolean;
  db: object;
  pool: Pool;
  innerster: string | null;
  kontext: string;
};
export const laufendeTx = new AsyncLocalStorage<TxStand>();
/** Der Sicherungspunkt, in dem dieser Aufrufpfad gerade läuft. */
const laufenderPunkt = new AsyncLocalStorage<{ stand: TxStand; name: string }>();

/** Für den Zeilenschutz (Migration 0111): wer gerade fragt, nur bis zum Ende
 * der Transaktion. Ein Wert auf Sitzungsebene bliebe an der Pool-Verbindung
 * hängen und gälte in der nächsten Anfrage eines anderen Kontos. Die Konto-ID
 * ist eine geprüfte ganze Zahl und darf deshalb ins SQL. Den Systemrahmen
 * trägt die Rolle der Verbindung (Migration 0112), keine Einstellung. */
export function kontextSql(): string {
  const { system, konto } = zeilenKontext();
  if (system || konto === null) return '';
  return `SELECT set_config('app.konto', '${konto}', true)`;
}
const KONTEXT_LEER = "SELECT set_config('app.konto', '', true)";

/** Wechselt das Konto mitten in der Transaktion (imNamenVon), folgt die Einstellung. */
export async function kontextAbgleich(stand: TxStand): Promise<void> {
  const soll = kontextSql();
  if (soll === stand.kontext) return;
  await stand.client.query(soll || KONTEXT_LEER);
  stand.kontext = soll;
}

export function txSchnittstelle(stand: TxStand): DbSchnittstelle {
  const q = async (sql: string, p?: unknown[]) => {
    nochOffen(stand);
    await kontextAbgleich(stand);
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
type CommitBegleiter = (tx: DbSchnittstelle) => Promise<void>;
export const commitBegleiter = new AsyncLocalStorage<CommitBegleiter>();
export function mitCommitBegleiter<T>(begleiter: CommitBegleiter, arbeit: () => T): T {
  return commitBegleiter.run(begleiter, arbeit);
}

/** Die Verbindung einer beendeten Transaktion ist schon zurück im Pool: Ein Nachzügler
 * (Promise.all bricht beim ersten Fehler ab, die anderen laufen weiter) verdürbe dort
 * die Transaktion eines Fremden. */
export class TransaktionBeendet extends Error {
  constructor() {
    super('Abfrage nach dem Ende ihrer Transaktion (Nachzügler aus Promise.all?)');
  }
}
function nochOffen(stand: TxStand): void {
  if (!stand.offen) throw new TransaktionBeendet();
}

export class NebenDerTransaktion extends Error {
  constructor(transaktionImSystemrahmen: boolean) {
    super(
      transaktionImSystemrahmen
        ? 'Abfrage ohne Systemrahmen in einer Transaktion des Systemrahmens: Sie liefe über eine zweite Verbindung neben ihr.'
        : 'Systemrahmen (imSystemkontext) mitten in einer Transaktion: Die Abfrage liefe über eine zweite ' +
            'Verbindung neben ihr. Den Rahmen vor der Transaktion betreten.',
    );
  }
}

export class GleichzeitigerSicherungspunkt extends Error {
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
 * die Arbeit des anderen mit. Deshalb muss jeder im innersten offenen beginnen. */
export function innereTransaktion<T>(
  stand: TxStand,
  nummer: number,
  fn: (tx: DbSchnittstelle) => Promise<T>,
): Promise<T> {
  const p = laufenderPunkt.getStore();
  const rahmen = p?.stand === stand ? p.name : null;
  if (stand.innerster !== rahmen) return Promise.reject(new GleichzeitigerSicherungspunkt(stand.innerster ?? ''));
  const name = `sp_${nummer}`;
  stand.innerster = name;
  return laufenderPunkt.run({ stand, name }, async () => {
    const { client } = stand;
    // ROLLBACK TO nimmt auch ein set_config() aus dem Sicherungspunkt zurück.
    const kontextVorher = stand.kontext;
    try {
      nochOffen(stand);
      await client.query(`SAVEPOINT ${name}`);
      try {
        const r = await fn(txSchnittstelle(stand));
        nochOffen(stand);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return r;
      } catch (e) {
        if (!stand.offen) throw e;
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        stand.kontext = kontextVorher;
        if (e !== null && typeof e === 'object') vomSicherungspunktAufgefangen.add(e);
        throw e;
      }
    } finally {
      stand.innerster = rahmen;
    }
  });
}

/** Nach ROLLBACK TO SAVEPOINT ist die Transaktion wieder benutzbar: Wer diesen
 * Fehler auffängt und einen Ersatz liefert, verdeckt nichts. */
const vomSicherungspunktAufgefangen = new WeakSet<object>();
setzeTransaktionsWaechter({
  verdirbt: e =>
    laufendeTx.getStore()?.offen === true &&
    !(e !== null && typeof e === 'object' && vomSicherungspunktAufgefangen.has(e)),
  streng: () => konfig().nodeEnv === 'test',
});
