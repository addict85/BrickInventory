/** Drossel, PDF-Tickets, Gutschein-Guthaben, Kontoschranke und Token-Zwischenspeicher
 * liegen im Speicher des Web-Prozesses. Ein zweiter auf derselben Datenbank hätte
 * eigene Zähler und Tickets (doppeltes Kontingent, Ticket aus A in B unbekannt).
 * Statt alles nach Postgres zu tragen, hält der Web-Prozess eine Sitzungssperre,
 * solange er lebt; ein zweiter startet nicht. */
import type { Client } from 'pg';
import type { Db } from '../db/database';
import { attemptsProcessLock } from '../db/prozessSperre';
import { reportError } from '../src/infra/fehler';
import { LOCKS } from '../src/infra/lockNamespaces';

export class SecondWebProcess extends Error {
  constructor(seconds: number) {
    super(
      `Ein zweiter Web-Prozess (ROLLE web oder beides) läuft schon auf dieser Datenbank; nach ${seconds} s ` +
        'Warten aufgegeben. Es darf nur einer laufen: Drossel, PDF-Tickets und Zwischenspeicher liegen im ' +
        'Prozessspeicher (UPGRADE.md#ein-web-prozess). Den anderen beenden oder hier ROLLE=jobs setzen.',
    );
  }
}

export interface Wait {
  /** So lange auf einen gerade endenden Vorgänger warten (Neustart, Deploy). */
  wartenMs?: number;
  taktMs?: number;
  /** Ging die Sperre verloren und ist nicht zurückzuholen; Vorgabe: Prozess beenden. */
  atLoss?: (e: Error) => void;
}

/** Ein Fehler beim Schliessen ändert nichts mehr; gemeldet wird er trotzdem. */
async function schliesse(c: Client): Promise<void> {
  try {
    await c.end();
  } catch (e) {
    reportError('web-sperre:schliessen', e);
  }
}

async function receiptsLock(db: Db, o: Required<Pick<Wait, 'wartenMs' | 'taktMs'>>): Promise<Client> {
  const c = await db.ownConnection();
  // Ohne Zuhörer beendete ein Abriss während des Wartens den Prozess ungefragt.
  c.on('error', () => {});
  const ende = Date.now() + o.wartenMs;
  let gemeldet = false;
  for (;;) {
    if (await attemptsProcessLock(c, LOCKS.WEB_PROCESS)) return c;
    if (!gemeldet)
      console.warn(
        `[start] Ein anderer Web-Prozess hält die Sperre – warte bis zu ${o.wartenMs / 1000} s auf sein Ende`,
      );
    gemeldet = true;
    if (Date.now() >= ende) {
      await schliesse(c);
      throw new SecondWebProcess(Math.round(o.wartenMs / 1000));
    }
    await new Promise(fertig => setTimeout(fertig, o.taktMs));
  }
}

/** @returns Freigabe (beim Herunterfahren). */
export async function holdWebLock(db: Db, o: Wait = {}): Promise<() => Promise<void>> {
  const frist = { wartenMs: o.wartenMs ?? 20_000, taktMs: o.taktMs ?? 1000 };
  const verloren =
    o.atLoss ??
    ((e: Error) => {
      console.error(`❌ [start] Sperre des Web-Prozesses verloren: ${e.message}`);
      process.exit(1);
    });
  let client: Client | null = null;
  let frei = false;
  // Reisst die Verbindung ab (Neustart der Datenbank), ist die Sperre weg: zurückholen,
  // solange die Datenbank fehlt immer wieder (live bleibt 200), aufgeben erst, wenn
  // inzwischen ein anderer Web-Prozess sie hält.
  const retrieve = () => {
    if (frei) return;
    receiptsLock(db, frist).then(hold, (e: unknown) =>
      e instanceof SecondWebProcess ? verloren(e) : setTimeout(retrieve, frist.taktMs),
    );
  };
  const hold = (c: Client) => {
    if (frei) return void schliesse(c);
    client = c;
    c.on('error', () => {
      if (frei || client !== c) return;
      client = null;
      retrieve();
    });
  };
  hold(await receiptsLock(db, frist));
  return async () => {
    frei = true;
    if (client) await schliesse(client);
    client = null;
  };
}
