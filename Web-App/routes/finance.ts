
/**
 * /api/finance — was NACH dem Zusammenlegen hier noch steht.
 *
 * ── Was weg ist (Etappe 5) ──────────────────────────────────────────────────
 * Bewertung (Sets/Teile/Minifiguren), GuV, Portfolio-Verlauf und die drei
 * Preisverlaufs-Routen standen doppelt: einmal hier für die Sitzung, einmal
 * unter /api/v1 für den Token. Die Rechnung selbst lag längst gemeinsam in
 * utils/financeCalc.ts, utils/priceHistory.ts und utils/portfolioHistory.ts —
 * doppelt waren nur die Routen davor, und genau dort sind in dieser Reihe die
 * Zahlen auseinandergelaufen (zuletzt: das Blickfeld fehlte beim
 * Minifiguren-Verlauf auf beiden Wegen, und die Bewertung lieferte hier ein
 * Feld weniger als drüben).
 *
 * Sie leben jetzt nur noch unter /api/v1; requireToken dort nimmt BEIDE
 * Ausweise (Session-Cookie oder Bearer), die Webapp ruft dieselbe Adresse auf.
 *
 * `/combined-valuation` ist ersatzlos entfallen: eine DRITTE Bewertungsfassung,
 * die niemand aufrief (weder Frontend noch App) und die ausserdem noch mit der
 * eigenen Benutzer-ID statt mit scopeIds() arbeitete — im Haushalt also falsch
 * gerechnet hätte, sobald jemand sie wieder angeschlossen hätte.
 *
 * ── Was bleibt ──────────────────────────────────────────────────────────────
 * Cache-Statistik, Preis-Job-Status und -Auslöser sowie das Leeren der Caches:
 * Werkzeuge der Admin-Oberfläche der Webapp, ohne Gegenstück in der App.
 */
import express from 'express';
const router  = express.Router();
import * as db from '../db/database';
import { handleRouteError } from '../utils/httpError';
import { requireLogin, requireAdmin } from './auth';
import { getRateLimitStatus } from '../utils/financeCalc';

// Bild-Helfer zentral in utils/images.ts — hier nur für den Re-Export am
// Dateiende, den jobs/ und routes/ weiterhin nutzen.
import { resolveImageLocal } from '../utils/images';
import { getSetting } from '../utils/settings';

const {
  checkAndIncrementRateLimit, getLimitForApi,
  fetchPrice, parallelLimit, fetchPartPrice, fetchMinifigPrice,
  computeSetsValuation, computeMinifigsValuation, computePartsValuation, computePnl,
} = require('../utils/financeCalc');

router.use(requireLogin);

// Cache-Statistik, Cache-Leeren und der Preis-Job liegen seit Etappe 7 unter
// /api/v1/admin/* — eine Fassung für beide Clients. Sie standen hier als
// Zweitfassung und liefen bereits auseinander: Die hiesige lieferte `db_pool`,
// die v1-Fassung nicht.
//
// Damit ist routes/finance.ts leer bis auf den Export. Die Datei bleibt, weil
// jobs/ und routes/ die Funktionen unten weiterhin von hier beziehen.

// CJS-kompatibler Export: module.exports bleibt der Router selbst,
// mit den intern/von jobs/ genutzten Funktionen als Properties (wie zuvor).
// ── Nur noch der Router (Nachtrag 126) ──────────────────────────────────────
//
// Hier standen dreizehn Namen im Anhang, von denen diese Datei KEINEN einzigen
// selbst herstellt: elf leben in utils/financeCalc.ts, einer in utils/settings.ts,
// einer in utils/images.ts. Der Router war eine reine Durchreiche.
//
// Bezahlt wurde sie mit siebzehn späten `require('./finance')` in acht Dateien —
// jedes davon ungeprüft (require() liefert `any`) und jedes ein Kreisschluss,
// weil ein Router alles mitzieht, was er selbst importiert. Wer den Marktpreis
// eines Teils braucht, holt ihn jetzt dort, wo er entsteht.
export = router;
