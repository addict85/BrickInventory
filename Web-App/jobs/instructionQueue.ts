/**
 * Anleitungen je Set laden — der Auftrag 'anleitung' (eingereiht über
 * src/auftraege/anleitungsAuftrag.ts). Brickset und brickinstructions.com wollen
 * Abstand: Nach einem echten Abruf pausiert die ganze Art 15 Sekunden, nach
 * einer Cloudflare-Sperre 5, 10, 15, 20 Minuten und dann bis zum nächsten Tag.
 * Ausführlich: docs/begruendungen/jobs/instructionQueue.ts.md#db
 */
import * as db from '../db/database';
import { downloadSetInstructions, letzterAbrufWarExtern, anzahlAnleitungen, scrapeInstructionsFromFallback } from '../src/katalog/instructions';
import { fehlertext } from '../src/infra/httpError';
import { alsAbrufFehler } from '../clients/abrufFehler';
import { zaehleArt } from '../src/auftraege/dienst';
import { beendePause } from '../src/auftraege/dienst';
import { pausiereArt } from '../src/auftraege/dienst';
import { liesPause } from '../src/auftraege/dienst';
import * as monitor from '../src/auftraege/jobMonitor';
import { LOCKS } from '../src/infra/lockNamespaces';
import { AuftragVerschieben } from './auftragsWorker';

/** Abstand nach einem Abruf, der wirklich einen fremden Server fragte. */
const TAKT_NACH_ABRUF_MS = 15_000;
/** Pausen nach der ersten bis vierten Cloudflare-Sperre; danach bis morgen. */
const CF_PAUSEN_MS = [5, 10, 15, 20].map(min => min * 60 * 1000);

/** 00:05 des nächsten Tages: Dann ist das Tageskontingent wieder frei. */
function naechsterTag(jetzt = new Date()): Date {
  const z = new Date(jetzt);
  z.setHours(0, 5, 0, 0);
  if (z <= jetzt) z.setDate(z.getDate() + 1);
  return z;
}

/**
 * Zwei Job-Prozesse sollen sich den Takt nicht teilen: Hält ein anderer die
 * Sperre, wartet dieser Auftrag einen Takt (auf eigener Verbindung, weil
 * Advisory-Locks an der Sitzung hängen).
 */
async function mitSperre<T>(lauf: () => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [LOCKS.ANLEITUNGS_QUEUE]);
    if (!rows[0]?.ok) throw new AuftragVerschieben(new Date(Date.now() + TAKT_NACH_ABRUF_MS), 'Anleitungen laufen in einem anderen Prozess');
    try { return await lauf(); }
    finally { await client.query('SELECT pg_advisory_unlock($1, 0)', [LOCKS.ANLEITUNGS_QUEUE]); }
  } finally { client.release(); }
}

async function meldeMonitor(setNumber: string): Promise<void> {
  const z = await zaehleArt('anleitung');
  const offen = z.offen + z.laeuft, gesamt = offen + z.erledigt + z.fehler;
  await monitor.update('instrQueue', { status: offen > 1 ? 'running' : 'done', progress: gesamt - offen + 1, total: gesamt,
    sub: offen > 1 ? `${setNumber} · ${offen - 1} ausstehend` : 'Alle erledigt' });
}

/** Der Bearbeiter. Eine Drosselung verschiebt den Auftrag, ohne ihn als Versuch zu zählen. */
async function anleitungLaden(n: Record<string, unknown>): Promise<void> {
  const sn = String(n.set_number);
  if (await anzahlAnleitungen(sn) > 0) return;
  if (n.nur_ausweichquelle) { await scrapeInstructionsFromFallback(sn); return; }
  await mitSperre(async () => {
    try {
      // eigenerTakt: Die Pausen in der Funktion entfallen, den Abstand hält die Pause der Art.
      const anzahl = await downloadSetInstructions(sn, true);
      console.log(`[instr-queue] ${sn}: ${anzahl} instructions`);
      if (await liesPause('anleitung')) await beendePause('anleitung');
      if (letzterAbrufWarExtern()) await pausiereArt('anleitung', new Date(Date.now() + TAKT_NACH_ABRUF_MS), 'Abstand zwischen zwei Abrufen');
      await meldeMonitor(sn);
    } catch (e) {
      const f = alsAbrufFehler(e);
      const msg = fehlertext(e) || '';
      if (f.isCloudflare || msg.includes('1015')) {
        const stufe = (await liesPause('anleitung'))?.stufe ?? 0;
        const bis = stufe < CF_PAUSEN_MS.length ? new Date(Date.now() + CF_PAUSEN_MS[stufe]!) : naechsterTag();
        const grund = stufe < CF_PAUSEN_MS.length
          ? `Cloudflare-Sperre: ${Math.round(CF_PAUSEN_MS[stufe]! / 60000)} min warten (Versuch ${stufe + 1})`
          : 'Cloudflare-Sperre: bis morgen pausiert';
        await pausiereArt('anleitung', bis, grund, stufe < CF_PAUSEN_MS.length ? stufe + 1 : 0);
        await monitor.update('instrQueue', { status: 'idle', sub: grund });
        console.log(`[instr-queue] ${grund}`);
        throw new AuftragVerschieben(bis, grund);
      }
      if (msg.includes('Tageslimit') || msg.includes('rate limit') || msg.includes('429')) {
        const bis = naechsterTag();
        await pausiereArt('anleitung', bis, 'Tageskontingent erschöpft');
        throw new AuftragVerschieben(bis, 'Tageskontingent erschöpft');
      }
      throw e;
    }
  });
}

export { TAKT_NACH_ABRUF_MS, CF_PAUSEN_MS, naechsterTag, anleitungLaden };
