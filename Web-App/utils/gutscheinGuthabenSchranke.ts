/**
 * Die Schranke vor der Guthaben-Abfrage: ein Aufruf je 30 Sekunden, und Ruhe,
 * wenn der Bot-Schutz anspricht.
 * Ausführlich: docs/begruendungen/utils/gutscheinGuthabenSchranke.ts.md#abschnitt
 */
import * as db from '../db/database';
import { holeGuthaben, BotSchutz, LAND_STANDARD, type Abruf, type Guthaben } from './gutscheinGuthaben';

/** Der Mindestabstand zwischen zwei Abfragen — Marcos Zahl. */
export const ABSTAND_SEK = 30;

/** Die Pause nach einem Bot-Schutz-Treffer — meine Zahl, Begründung oben. */
export const BOTSCHUTZ_PAUSE_MIN = 30;

/** Warum nicht abgefragt wurde, und wie lange es noch dauert. */
export interface Gesperrt {
  grund: 'abstand' | 'botschutz';
  wartenSek: number;
}

/** Das Ergebnis eines Abfrageversuchs. */
export type Abfrage =
  | { art: 'guthaben'; guthaben: Guthaben }
  | ({ art: 'gesperrt' } & Gesperrt);

/**
 * Den Platz belegen — oder sagen, wie lange es noch dauert.
 * Ausführlich: docs/begruendungen/utils/gutscheinGuthabenSchranke.ts.md#belegeplatz
 */
export async function belegePlatz(): Promise<{ frei: true } | ({ frei: false } & Gesperrt)> {
  return db.transaction(async (tx) => {
    // Die Zeile anlegen, falls die Migration sie nicht schon gesetzt hat (eine
    // Datenbank, die aus einer älteren Sicherung kommt). NULL in beiden
    // Spalten heisst „noch nie" — ein Datum wäre eine Behauptung.
    await tx.run(
      `INSERT INTO gutschein_guthaben_schranke (id) VALUES (1)
       ON CONFLICT (id) DO NOTHING`);

    // Gerechnet wird in SQL: EINE Zeile, EINE Sperre, EINE Uhr. Eine feste
    // Sperr-Reihenfolge wie bei checkAndIncrementRateLimit („ORDER BY key",
    // gegen Deadlocks zwischen zwei Zeilen) braucht es hier nicht — es gibt
    // nur die eine.
    const z = await tx.get(
      `SELECT CEIL(GREATEST(0, EXTRACT(EPOCH FROM (sperre_bis - NOW()))))::int
                AS sperre_sek,
              CEIL(GREATEST(0, EXTRACT(EPOCH FROM (
                letzter_abruf + make_interval(secs => $1) - NOW()))))::int
                AS abstand_sek
         FROM gutschein_guthaben_schranke
        WHERE id = 1
          FOR UPDATE`,
      [ABSTAND_SEK]) as { sperre_sek?: unknown; abstand_sek?: unknown } | undefined;

    // NULL (= noch nie) kommt als NaN zurück und bedeutet „kein Rest".
    const rest = (w: unknown) => { const n = Number(w); return Number.isFinite(n) ? n : 0; };

    // Die Sperre zuerst: Sie ist der stärkere Grund, und wer sie meldet, soll
    // nicht „noch 12 Sekunden" hören, wenn es 20 Minuten sind.
    const sperre = rest(z?.sperre_sek);
    if (sperre > 0) return { frei: false as const, grund: 'botschutz' as const, wartenSek: sperre };

    const abstand = rest(z?.abstand_sek);
    if (abstand > 0) return { frei: false as const, grund: 'abstand' as const, wartenSek: abstand };

    await tx.run('UPDATE gutschein_guthaben_schranke SET letzter_abruf = NOW() WHERE id = 1');
    return { frei: true as const };
  });
}

/**
 * Nach einem Bot-Schutz-Treffer: eine Weile gar nicht mehr fragen.
 *
 * @returns die Pause in Sekunden, wie sie der Oberfläche gemeldet wird
 */
export async function sperreWegenBotschutz(): Promise<number> {
  await db.run(
    `INSERT INTO gutschein_guthaben_schranke (id, sperre_bis)
     VALUES (1, NOW() + make_interval(mins => $1))
     ON CONFLICT (id) DO UPDATE SET sperre_bis = EXCLUDED.sperre_bis`,
    [BOTSCHUTZ_PAUSE_MIN]);
  return BOTSCHUTZ_PAUSE_MIN * 60;
}

/** Nur für Tests: die Buchhaltung vergessen. */
export async function vergesseSchranke(): Promise<void> {
  await db.run(
    'UPDATE gutschein_guthaben_schranke SET letzter_abruf = NULL, sperre_bis = NULL WHERE id = 1');
}

/**
 * Das Guthaben abfragen — durch die Schranke.
 * Ausführlich: docs/begruendungen/utils/gutscheinGuthabenSchranke.ts.md#frageguthabenab
 */
export async function frageGuthabenAb(
  nummer: string, pin: string, opt: { locale?: string; abruf?: Abruf } = {},
): Promise<Abfrage> {
  const platz = await belegePlatz();
  if (!platz.frei) {
    return { art: 'gesperrt', grund: platz.grund, wartenSek: platz.wartenSek };
  }
  try {
    // Die Eigenschaften einzeln setzen statt `abruf: opt.abruf`:
    // exactOptionalPropertyTypes unterscheidet „nicht gesetzt" von „auf
    // undefined gesetzt", und `holeGuthaben` setzt bei NICHT gesetzt den
    // echten fetch ein.
    const durch: { locale: string; abruf?: Abruf } = { locale: opt.locale || LAND_STANDARD };
    if (opt.abruf) durch.abruf = opt.abruf;
    const guthaben = await holeGuthaben(nummer, pin, durch);
    return { art: 'guthaben', guthaben };
  } catch (e) {
    if (e instanceof BotSchutz) {
      const wartenSek = await sperreWegenBotschutz();
      console.warn(`[guthaben] Bot-Schutz — ${BOTSCHUTZ_PAUSE_MIN} Minuten Pause: ${e.message}`);
      return { art: 'gesperrt', grund: 'botschutz', wartenSek };
    }
    throw e;
  }
}
