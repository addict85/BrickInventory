// ── Echte Importe statt später require() ─────────────────────
//
// Beim Auslagern aus server.ts wanderten zehn `require('./jobs/...')`
// WORTGLEICH mit. Aus startup/ gesehen gibt es './jobs' nicht — jeder dieser
// Aufrufe warf, und weil sie in `setTimeout`/`.catch(() => {})` stecken, blieb
// es still: KEIN Job lief mehr an, ohne eine einzige Fehlermeldung.
import { start as starteJobPreise } from '../jobs/priceJob';
import { start as starteJobBilder } from '../jobs/imageQueue';
import { processRetryQueue } from '../jobs/bricksetRetry';
import * as purchasePriceBackfill from '../jobs/purchasePriceBackfill';
import { start as starteJobAnleitungen } from '../jobs/instructionQueue';
import * as catalogSync from '../jobs/catalogSync';
import * as nachlaeufe from '../jobs/startNachlaeufe';
import { purgeAltePreise } from '../utils/priceHistory';
import { purgeExpiredTokens } from '../utils/auth';
import { raeumeAnmeldezaehlerAuf } from '../utils/loginLimiter';
import { verschluesseleAltbestand } from '../utils/geheimnisAltbestand';
import { raeumePapierkorbAuf } from '../utils/papierkorb';
import { logAndContinue } from '../utils/httpError';
import { startImgCacheCleanup } from '../routes/imgProxy';
import { startPdfJobCleanup } from '../routes/api_v1/pdf';
import { starteAuftragsWorker } from '../jobs/auftraegeStarten';

/**
 * Was nach dem Start im Hintergrund anläuft — ausschliesslich im Primär-Worker.
 * Ausführlich: docs/begruendungen/startup/backgroundJobs.ts.md#startehintergrundlaeufe
 */
export async function starteHintergrundlaeufe(): Promise<void> {
  // HINWEIS: Hier standen zwei einmalige Umzüge — migrateImagesToData()
  // (public/images/ → data/images/) und migrateLayout() (data/part_images/
  // → data/images/{parts,minifigs}/, data/instructions/shared/ →
  // data/instructions/). Beide sind entfernt, nachdem der Umzug auf der …
  // Ausführlich: docs/begruendungen/startup/backgroundJobs.ts.md#abschnitt

  // Die Auftragstabelle (Nacharbeit, Bilder, PDF, CSV-Import); was vor einem
  // Neustart offen war, läuft hier weiter.
  starteAuftragsWorker();

  // Abgelaufene API-Tokens aufräumen.
  //
  // Jeder Login legt eine webapp-session-Zeile mit sieben Tagen Laufzeit an.
  // Entfernt hat sie bisher niemand — auch nach Ablauf nicht, weil
  // validateToken() abgelaufene Zeilen nur ignoriert statt sie zu löschen.
  // Die Tabelle wuchs damit monoton mit der Zahl der Anmeldungen.
  {
    const purge = async () => {
      const n = await purgeExpiredTokens().catch(() => 0);
      if (n) console.log(`[tokens] ${n} abgelaufene Token entfernt`);
    };
    purge();
    setInterval(purge, 60 * 60 * 1000).unref();
  }

  // Klartext-Geheimnisse aus der Zeit vor der Verschlüsselung (utils/geheimnis.ts).
  verschluesseleAltbestand()
    .then(n => { if (n) console.log(`[geheimnis] ${n} Geheimnisse nachträglich verschlüsselt`); })
    .catch(logAndContinue('geheimnis:altbestand'));

  // Abgelaufene Anmeldezähler (utils/loginLimiter.ts).
  {
    const zaehler = async () => { await raeumeAnmeldezaehlerAuf().catch(logAndContinue('anmeldung:zaehler aufräumen')); };
    zaehler();
    setInterval(zaehler, 60 * 60 * 1000).unref();
  }

  // Papierkorb-Einträge nach Ablauf der 30 Tage entfernen.
  {
    const leeren = async () => {
      const n = await raeumePapierkorbAuf().catch(logAndContinue('papierkorb:aufräumen'));
      if (n) console.log(`[papierkorb] ${n} abgelaufene Einträge entfernt`);
    };
    leeren();
    setInterval(leeren, 60 * 60 * 1000).unref();
  }

  // Bild-Cache aufräumen — hier statt in registerImgProxy(), weil das in
  // JEDEM Worker läuft: Vorher legte jeder Prozess sein eigenes tägliches
  // Intervall an und ging das ganze Cache-Verzeichnis durch. Siehe
  // startImgCacheCleanup() in routes/imgProxy.ts.
  startImgCacheCleanup();

  // PDF-Aufträge aufräumen — aus demselben Grund hier: Vorher hing das
  // Aufräumen am POST für ein neues PDF. Wer einen Export abbrach und nie
  // wieder einen startete, liess PDF und Auftragsdatei dauerhaft liegen.
  startPdfJobCleanup();

  // Preisverlauf beschneiden. Die Tabelle wuchs unbegrenzt (rund 292 000
  // Zeilen im Jahr bei 800 Sets), und die Portfolio-Kurve liest für „Max"
  // jede Zeile. Steuerbar über PRICE_HISTORY_KEEP_DAYS (Vorgabe 1095, 0 = aus).
  {
    const beschneiden = async () => {
      const n = await purgeAltePreise().catch(() => 0);
      if (n) console.log(`[price-history] ${n} alte Preis-Zeilen entfernt`);
    };
    beschneiden();
    setInterval(beschneiden, 24 * 60 * 60 * 1000).unref();
  }

  // PriceJob — primary worker only
  starteJobPreise();

  // One-time migration: backfill purchase_price for existing sets/minifigs/parts
  // that don't have one yet, using the current market price (see feature: Kaufpreis).
  setTimeout(() => purchasePriceBackfill.run().catch(() => {}), 45000);

  starteJobAnleitungen();

  // Bilder, die über den Proxy angefragt wurden, im Hintergrund lokal ablegen
  // und verkleinern. Die Anfrage selbst rechnet nichts mehr.
  starteJobBilder();

  setTimeout(() => catalogSync.syncAllMissing().catch(() => {}), 10000);

  // Sets ohne Anleitung in die Warteschlange (jobs/startNachlaeufe.ts).
  setTimeout(() => nachlaeufe.anleitungenNachtragen().catch(() => {}), 15000);
  setTimeout(() => processRetryQueue().catch(() => {}), 20000);

  // Fehlende Set-Bilder vom CDN (jobs/startNachlaeufe.ts).
  setTimeout(() => nachlaeufe.setBilderNachladen().catch(() => {}), 45_000);

  // Fehlende Vorschaubilder (jobs/startNachlaeufe.ts).
  setImmediate(() => { nachlaeufe.vorschaubilderNachtragen().catch(() => {}); });
}
