import * as db from '../db/database';
import { refreshPriceForSet } from '../jobs/priceJob';
import { getSetValue } from './setValue';
import { nutzerStandardZustand as userDefaultCondition } from './settings';
import { getGlobalSetting } from './settings';
import { DEFAULT_PRICE_CONDITION } from './financeCalc';

/**
 * Der aktuelle Marktpreis eines Sets.
 *
 * ── Warum nicht mehr in routes/sets.ts (Nachtrag 125) ───────────────────────
 * Sieben Aufrufer, keiner konnte sie importieren: Der Router schliesst mit
 * parts/minifigs/jobs mehrere Kreise, also holten alle sie per spätem
 * `require()` — und damit ungeprüft. Genau diese Sorte Aufruf hat in Nachtrag
 * 131 zwei 500er verursacht.
 *
 * Hier ist sie ein Blatt: db, priceJob, setValue, settings — kein Rückbezug.
 * Das späte `require('../utils/setValue')` im Rumpf konnte dabei ebenfalls
 * durch einen echten Import ersetzt werden.
 */

async function getCurrentMarketPrice(setNumber: string, userId: number, condition: string | null = null) {
  try {
    const currencyRow = await db.get('SELECT value FROM user_settings WHERE user_id=$1 AND key=$2', [userId, 'currency']);
    const globalCurrency = await getGlobalSetting('currency');
    const currency = currencyRow?.value || globalCurrency || 'EUR';
    // Effective condition: parameter → user setting → global setting → 'N'
    const effectiveCond = condition || await userDefaultCondition(userId).catch(()=>DEFAULT_PRICE_CONDITION);
    // condition als Hinweis mitgeben: Beim Anlegen eines neuen Sets existieren
    // weder sets- noch set_acquisitions-Zeile schon, refreshPriceForSet könnte
    // sonst nur den Standardzustand holen (siehe jobs/priceJob.ts).
    await refreshPriceForSet(setNumber, userId, condition).catch(() => {});

    // Ist ein Zustand AUSDRÜCKLICH angefragt, gilt genau der.
    //
    // Sonst entschied getSetValue() anhand der Erfassungen — und beim Anlegen
    // eines neuen Sets gibt es noch keine. Die Funktion fiel dann auf
    // sets.condition zurück, das ebenfalls noch nicht geschrieben war, also auf
    // 'N'. Ein als gebraucht erfasstes Set bekam so den Neupreis (55 statt 33).
    // Der weiter oben berechnete effectiveCond wurde nur im unerreichbaren
    // Rückfall darunter benutzt.
    if (!condition) {
      // Ohne ausdrücklichen Wunsch: Bewertung je Erfassung nach deren Zustand
      // (utils/setValue.ts) — das ist der richtige Wert für eine Anzeige.
      const v = await getSetValue(userId, setNumber, currency);
      if (v.unit_price !== null) return v.unit_price;
    }

    // Angefragter Zustand zuerst; der andere nur, wenn dort kein Preis steht.
    const cached = await db.get(
      `SELECT avg_price FROM price_cache
       WHERE set_number=$1 AND condition IN ('N','U') AND currency_code=$3 AND avg_price > 0
       ORDER BY (condition = $2) DESC LIMIT 1`,
      [setNumber, effectiveCond, currency]
    );
    const price = parseFloat(cached?.avg_price || 0);
    return price > 0 ? price : null;
  } catch (_) { return null; }
}

export { getCurrentMarketPrice };
