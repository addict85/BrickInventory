/** Drossel, PDF-Tickets, Gutschein-Guthaben, Kontoschranke und Token-Zwischenspeicher
 * liegen im Speicher des Web-Prozesses. Ein zweiter auf derselben Datenbank hätte
 * eigene Zähler und Tickets (doppeltes Kontingent, Ticket aus A in B unbekannt).
 * Statt alles nach Postgres zu tragen, hält der Web-Prozess eine Sitzungssperre,
 * solange er lebt; ein zweiter startet nicht. */
import type { Client } from 'pg';
import type { Db } from '../db/database';
import { versucheProzessSperre } from '../db/prozessSperre';
import { meldeFehler } from '../src/infra/fehler';
import { LOCKS } from '../src/infra/lockNamespaces';

export class ZweiterWebProzess extends Error {
  constructor(sekunden: number) {
    super(
      `Ein zweiter Web-Prozess (ROLLE web oder beides) läuft schon auf dieser Datenbank; nach ${sekunden} s ` +
        'Warten aufgegeben. Es darf nur einer laufen: Drossel, PDF-Tickets und Zwischenspeicher liegen im ' +
        'Prozessspeicher (UPGRADE.md#ein-web-prozess). Den anderen beenden oder hier ROLLE=jobs setzen.',
    );
  }
}

export interface Warten {
  /** So lange auf einen gerade endenden Vorgänger warten (Neustart, Deploy). */
  wartenMs?: number;
  taktMs?: number;
  /** Ging die Sperre verloren und ist nicht zurückzuholen; Vorgabe: Prozess beenden. */
  beiVerlust?: (e: Error) => void;
}

/** Ein Fehler beim Schliessen ändert nichts mehr; gemeldet wird er trotzdem. */
async function schliesse(c: Client): Promise<void> {
  try {
    await c.end();
  } catch (e) {
    meldeFehler('web-sperre:schliessen', e);
  }
}

async function versuche(db: Db, o: Required<Pick<Warten, 'wartenMs' | 'taktMs'>>): Promise<Client> {
  const c = await db.eigeneVerbindung();
  // Ohne Zuhörer beendete ein Abriss während des Wartens den Prozess ungefragt.
  c.on('error', () => {});
  const ende = Date.now() + o.wartenMs;
  let gemeldet = false;
  for (;;) {
    if (await versucheProzessSperre(c, LOCKS.WEB_PROZESS)) return c;
    if (!gemeldet)
      console.warn(
        `[start] Ein anderer Web-Prozess hält die Sperre – warte bis zu ${o.wartenMs / 1000} s auf sein Ende`,
      );
    gemeldet = true;
    if (Date.now() >= ende) {
      await schliesse(c);
      throw new ZweiterWebProzess(Math.round(o.wartenMs / 1000));
    }
    await new Promise(fertig => setTimeout(fertig, o.taktMs));
  }
}

/** @returns Freigabe (beim Herunterfahren). */
export async function halteWebSperre(db: Db, o: Warten = {}): Promise<() => Promise<void>> {
  const frist = { wartenMs: o.wartenMs ?? 20_000, taktMs: o.taktMs ?? 1000 };
  const verloren =
    o.beiVerlust ??
    ((e: Error) => {
      console.error(`❌ [start] Sperre des Web-Prozesses verloren: ${e.message}`);
      process.exit(1);
    });
  let client: Client | null = null;
  let frei = false;
  // Reisst die Verbindung ab (Neustart der Datenbank), ist die Sperre weg: zurückholen
  // oder aufgeben, sonst könnte inzwischen ein zweiter Web-Prozess starten.
  const halte = (c: Client) => {
    client = c;
    c.on('error', () => {
      if (frei || client !== c) return;
      client = null;
      versuche(db, frist).then(halte, verloren);
    });
  };
  halte(await versuche(db, frist));
  return async () => {
    frei = true;
    if (client) await schliesse(client);
    client = null;
  };
}
