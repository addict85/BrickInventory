import type { DbSchnittstelle } from '../../db/database';
import { aktuellesKonto } from '../infra/kontoKontext';
import * as repo from './repository/apiKontingent';
import type { FremdquellenKontext } from './kontext';

export type ApiName = 'bricklink' | 'rebrickable' | 'brickset';

export const REBRICKABLE_DEFAULT_DAILY = 25000;
const VORGABEN: Record<ApiName, number> = { bricklink: 4000, rebrickable: REBRICKABLE_DEFAULT_DAILY, brickset: 100 };

/** Je Konto (ausser Verwaltern): Sonst verbrauchte ein Unterkonto das
 * Kontingent aller. */
export const ANTEIL_JE_KONTO = 0.25;

/** Alle Nicht-Verwalter zusammen; die andere Hälfte bleibt Verwaltern und dem
 * Hintergrund. Gezählt in der Zeile `konto = -1`. */
export const ANTEIL_ALLE_KONTEN = 0.5;
const ALLE_KONTEN = -1;

const heute = () => new Date().toISOString().slice(0, 10);

export async function getLimitForApi(k: FremdquellenKontext, apiName: ApiName): Promise<number> {
  return parseInt(await k.einstellungen.getGlobalSetting(`api_limit_${apiName}`, ''), 10) || VORGABEN[apiName] || 4000;
}

const grenzeJeKonto = (limit: number) => Math.max(1, Math.ceil(limit * ANTEIL_JE_KONTO));
const grenzeAlleKonten = (limit: number) => Math.max(1, Math.ceil(limit * ANTEIL_ALLE_KONTEN));

/** Atomar: Das Upsert erhöht nur unter der Grenze, und scheitert die Grenze des
 * Kontos, fällt auch die Gesamtzählung zurück. */
export async function checkAndIncrementRateLimit(k: FremdquellenKontext, apiName: ApiName, _vorgabe?: number) {
  const limit = await getLimitForApi(k, apiName);
  const tag = heute();
  const konto = aktuellesKonto();
  const zaehle = async (tx: DbSchnittstelle, id: number, grenze: number): Promise<number | null> => {
    const z = await repo.zaehleApiAufruf(tx, tag, apiName, id, grenze);
    return z ? Number(z.anzahl) : null;
  };
  if (limit <= 0) return { allowed: false, count: 0, limit, remaining: 0 };
  return k
    .transaktion(async t => {
      const gesamt = await zaehle(t.db, 0, limit);
      if (gesamt === null) return { allowed: false, count: limit, limit, remaining: 0 };
      if (konto && !konto.verwalter) {
        const alle = await zaehle(t.db, ALLE_KONTEN, grenzeAlleKonten(limit));
        const eigen = alle === null ? null : await zaehle(t.db, konto.id, grenzeJeKonto(limit));
        if (eigen === null) throw Object.assign(new Error('kontingent_je_konto'), { kontoVoll: true });
      }
      return { allowed: true, count: gesamt, limit, remaining: limit - gesamt };
    })
    .catch((e: { kontoVoll?: boolean }) => {
      if (e?.kontoVoll) return { allowed: false, count: 0, limit, remaining: 0, jeKonto: true };
      throw e;
    });
}

export async function getRateLimitStatus(k: FremdquellenKontext, apiName: ApiName) {
  const tag = heute();
  const [z, limit] = await Promise.all([k.apiKontingent.aufrufeHeute(tag, apiName), getLimitForApi(k, apiName)]);
  const count = Number(z?.anzahl || 0);
  return { count, limit, remaining: Math.max(0, limit - count), date: tag };
}

/** Zählt NICHT: Die Aufrufer fragen vorher, damit ein erschöpftes Kontingent
 * als solches gemeldet wird statt als Abruffehler. */
export async function kontingentFrei(kx: FremdquellenKontext, apiName: ApiName) {
  const s = await getRateLimitStatus(kx, apiName);
  const konto = aktuellesKonto();
  if (!konto || konto.verwalter || s.remaining <= 0) return { allowed: s.remaining > 0, limit: s.limit };
  const z = await kx.apiKontingent.aufrufeJeKonto(s.date, apiName, konto.id, ALLE_KONTEN);
  const stand = (k: number) => Number(z.find(r => Number(r.konto) === k)?.anzahl || 0);
  return {
    allowed: stand(konto.id) < grenzeJeKonto(s.limit) && stand(ALLE_KONTEN) < grenzeAlleKonten(s.limit),
    limit: s.limit,
  };
}

export async function setzeKontingentZurueck(k: FremdquellenKontext, apiName: ApiName): Promise<void> {
  await k.apiKontingent.setzeApiZaehlerZurueck(heute(), apiName);
}
