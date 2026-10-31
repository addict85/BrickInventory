import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';
import { aktuellesKonto } from '../infra/anfrageKonto';
import { getGlobalSetting } from '../konto/settings';

/** Tageskontingente der externen Dienste — eine Stelle für alle Zähler. */
export type ApiName = 'bricklink' | 'rebrickable' | 'brickset';

/** Rebrickable: 1 Aufruf/s, Tagesgrenze aus den Einstellungen, sonst diese. */
export const REBRICKABLE_DEFAULT_DAILY = 25000;
const VORGABEN: Record<ApiName, number> = { bricklink: 4000, rebrickable: REBRICKABLE_DEFAULT_DAILY, brickset: 100 };

/**
 * Anteil am Tageskontingent je Konto (ausser Verwaltern). Ohne Grenze je Konto
 * verbrauchte ein einzelnes Unterkonto das Kontingent aller.
 */
export const ANTEIL_JE_KONTO = 0.25;

/**
 * Anteil aller Nicht-Verwalter zusammen. Vier Konten zu je einem Viertel
 * leerten sonst das ganze Kontingent; die andere Hälfte bleibt Verwaltern und
 * dem Hintergrund (Katalogabgleich). Gezählt in der Zeile `konto = -1`.
 */
export const ANTEIL_ALLE_KONTEN = 0.5;
const ALLE_KONTEN = -1;

const heute = () => new Date().toISOString().slice(0, 10);

export async function getLimitForApi(apiName: ApiName): Promise<number> {
  return parseInt(await getGlobalSetting(`api_limit_${apiName}`)) || VORGABEN[apiName] || 4000;
}

const grenzeJeKonto = (limit: number) => Math.max(1, Math.ceil(limit * ANTEIL_JE_KONTO));
const grenzeAlleKonten = (limit: number) => Math.max(1, Math.ceil(limit * ANTEIL_ALLE_KONTEN));

/**
 * Einen Aufruf zählen, wenn das Kontingent es zulässt — gesamt und, bei einer
 * Anfrage eines Nicht-Verwalters, für alle Konten zusammen und je Konto. Atomar: Das Upsert erhöht nur unter
 * der Grenze, und scheitert die Grenze des Kontos, fällt auch die Gesamtzählung zurück.
 */
export async function checkAndIncrementRateLimit(apiName: ApiName, _vorgabe?: number) {
  const limit = await getLimitForApi(apiName);
  const tag = heute();
  const konto = aktuellesKonto();
  const zaehle = async (tx: DbSchnittstelle, id: number, grenze: number): Promise<number | null> => {
    const z = await tx.get(`
      INSERT INTO api_aufrufe (tag, api, konto, anzahl) VALUES ($1, $2, $3, 1)
      ON CONFLICT (tag, api, konto) DO UPDATE SET anzahl = api_aufrufe.anzahl + 1
       WHERE api_aufrufe.anzahl < $4
      RETURNING anzahl`, [tag, apiName, id, grenze]);
    return z ? Number(z.anzahl) : null;
  };
  if (limit <= 0) return { allowed: false, count: 0, limit, remaining: 0 };
  return db.transaction(async (tx) => {
    const gesamt = await zaehle(tx, 0, limit);
    if (gesamt === null) return { allowed: false, count: limit, limit, remaining: 0 };
    if (konto && !konto.verwalter) {
      const alle = await zaehle(tx, ALLE_KONTEN, grenzeAlleKonten(limit));
      const eigen = alle === null ? null : await zaehle(tx, konto.id, grenzeJeKonto(limit));
      if (eigen === null) throw Object.assign(new Error('kontingent_je_konto'), { kontoVoll: true });
    }
    return { allowed: true, count: gesamt, limit, remaining: limit - gesamt };
  }).catch((e: { kontoVoll?: boolean }) => {
    if (e?.kontoVoll) return { allowed: false, count: 0, limit, remaining: 0, jeKonto: true };
    throw e;
  });
}

/** Stand des Tageskontingents (gesamt). */
export async function getRateLimitStatus(apiName: ApiName) {
  const tag = heute();
  const [z, limit] = await Promise.all([
    db.get('SELECT anzahl FROM api_aufrufe WHERE tag = $1 AND api = $2 AND konto = 0', [tag, apiName]),
    getLimitForApi(apiName),
  ]);
  const count = Number(z?.anzahl || 0);
  return { count, limit, remaining: Math.max(0, limit - count), date: tag };
}

/**
 * Ist noch etwas übrig — gesamt und für das anfragende Konto? Zählt NICHT; die
 * Aufrufer fragen vorher, damit ein erschöpftes Kontingent als solches gemeldet
 * wird statt als Abruffehler.
 */
export async function kontingentFrei(apiName: ApiName) {
  const s = await getRateLimitStatus(apiName);
  const konto = aktuellesKonto();
  if (!konto || konto.verwalter || s.remaining <= 0) return { allowed: s.remaining > 0, limit: s.limit };
  const z = await db.all<{ konto: number; anzahl: number }>(
    'SELECT konto, anzahl FROM api_aufrufe WHERE tag = $1 AND api = $2 AND konto IN ($3, $4)',
    [s.date, apiName, konto.id, ALLE_KONTEN]);
  const stand = (k: number) => Number(z.find(r => Number(r.konto) === k)?.anzahl || 0);
  return { allowed: stand(konto.id) < grenzeJeKonto(s.limit) && stand(ALLE_KONTEN) < grenzeAlleKonten(s.limit),
           limit: s.limit };
}

/** Den heutigen Zähler eines Dienstes zurücksetzen (Verwalter, „jetzt erneut versuchen“). */
export async function setzeKontingentZurueck(apiName: ApiName): Promise<void> {
  await db.run('DELETE FROM api_aufrufe WHERE tag = $1 AND api = $2', [heute(), apiName]);
}
