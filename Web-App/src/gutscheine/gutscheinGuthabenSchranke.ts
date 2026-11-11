/** Ein Aufruf je 30 Sekunden über alle Konten, und Ruhe, wenn der Bot-Schutz
 * anspricht — sonst sperrt LEGO die Adresse. */
import { holeGuthaben, BotSchutz, LAND_STANDARD, verdecke, type Abruf, type Guthaben } from './gutscheinGuthaben';
import { Fachfehler } from '../infra/fehlerTexte';
import * as repo from './repository/guthabenSchranke';
import { gutscheineBereich } from './prozess';

export const ABSTAND_SEK = 30;

export const BOTSCHUTZ_PAUSE_MIN = 30;

/** Vor der Grenze für alle: Ein Konto allein belegt den Platz je 30 s nicht
 * dauerhaft und löst den Bot-Schutz nicht beliebig oft für alle aus. */
export const KONTO_JE_STUNDE = 20;

export interface Gesperrt {
  grund: 'konto' | 'abstand' | 'botschutz';
  wartenSek: number;
}

export type Abfrage =
  | { art: 'guthaben'; guthaben: Guthaben }
  | ({ art: 'gesperrt' } & Gesperrt);

/** In der Datenbank, damit die Grenze über alle Prozesse gilt. */
export async function belegePlatz(uid: number): Promise<{ frei: true } | ({ frei: false } & Gesperrt)> {
  return gutscheineBereich().db.transaction(async (tx) => {
    // Falls eine ältere Sicherung die Zeile nicht hat. NULL heisst „noch nie" —
    // ein Datum wäre eine Behauptung.
    await repo.legeSchrankeAn(tx);

    // In SQL: EINE Zeile, EINE Sperre, EINE Uhr.
    const z = await repo.schrankenStand(tx, ABSTAND_SEK) as { sperre_sek?: unknown; abstand_sek?: unknown } | undefined;

    // NULL (= noch nie) kommt als NaN zurück und bedeutet „kein Rest".
    const rest = (w: unknown) => { const n = Number(w); return Number.isFinite(n) ? n : 0; };

    const konto = await repo.kontoStand(tx, uid);
    if (rest(konto?.anzahl) >= KONTO_JE_STUNDE)
      return { frei: false as const, grund: 'konto' as const, wartenSek: Math.max(1, rest(konto?.warten_sek)) };

    // Die Sperre zuerst: Wer sie meldet, soll nicht „noch 12 Sekunden" hören,
    // wenn es 20 Minuten sind.
    const sperre = rest(z?.sperre_sek);
    if (sperre > 0) return { frei: false as const, grund: 'botschutz' as const, wartenSek: sperre };

    const abstand = rest(z?.abstand_sek);
    if (abstand > 0) return { frei: false as const, grund: 'abstand' as const, wartenSek: abstand };

    await repo.merkeAbruf(tx);
    await repo.zaehleKonto(tx, uid);
    return { frei: true as const };
  });
}

/** @returns die Pause in Sekunden, wie sie der Oberfläche gemeldet wird */
export async function sperreWegenBotschutz(): Promise<number> {
  await gutscheineBereich().guthabenSchranke.sperreSchranke(BOTSCHUTZ_PAUSE_MIN);
  return BOTSCHUTZ_PAUSE_MIN * 60;
}

export async function vergesseSchranke(): Promise<void> {
  await gutscheineBereich().guthabenSchranke.oeffneSchranke();
}

// Der einzige Weg zur Abfrage, damit niemand die Schranke umgeht.
export async function frageGuthabenAb(
  uid: number, nummer: string, pin: string, opt: { locale?: string; abruf?: Abruf } = {},
): Promise<Abfrage> {
  const platz = await belegePlatz(uid);
  if (!platz.frei) {
    return { art: 'gesperrt', grund: platz.grund, wartenSek: platz.wartenSek };
  }
  try {
    // Einzeln setzen: exactOptionalPropertyTypes unterscheidet „nicht gesetzt" von
    // „undefined", und nur bei „nicht gesetzt" nimmt holeGuthaben den echten fetch.
    const durch: { locale: string; abruf?: Abruf } = { locale: opt.locale || LAND_STANDARD };
    if (opt.abruf) durch.abruf = opt.abruf;
    const guthaben = await holeGuthaben(nummer, pin, durch);
    return { art: 'guthaben', guthaben };
  } catch (e) {
    if (e instanceof BotSchutz) {
      const wartenSek = await sperreWegenBotschutz();
      console.warn(`[guthaben] Bot-Schutz — ${BOTSCHUTZ_PAUSE_MIN} Minuten Pause: ${e.message}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      return { art: 'gesperrt', grund: 'botschutz', wartenSek };
    }
    // Ein Fehler der Gegenseite ist kein Serverfehler: Wer gefragt hat, soll den Grund lesen.
    const grund = verdecke(String((e as Error)?.message || e), nummer, pin);
    console.warn(`[guthaben] Abfrage gescheitert: ${grund}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    throw new Fachfehler('fremddienst', 'guthaben_fehlgeschlagen', { grund });
  }
}
