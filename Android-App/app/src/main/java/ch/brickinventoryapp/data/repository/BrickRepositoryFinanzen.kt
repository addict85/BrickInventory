package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust.
 *
 * ── Warum eigene Datei (Nachtrag 155) ───────────────────────────────────────
 *
 * BrickRepository hatte 78 oeffentliche Funktionen in 519 Zeilen und war damit
 * die Anlaufstelle fuer alles zugleich. Die Funktionen sind hier als
 * ERWEITERUNGSFUNKTIONEN abgelegt, nach Sachgebiet getrennt.
 *
 * Fuer Aufrufer aendert sich nichts: `repo.getFigPriceHistory(...)` loest
 * genauso auf wie zuvor. Die Ruempfe sind WORTGLEICH uebernommen; veraendert
 * wurde nur die Einrueckung und der Empfaenger in der Signatur.
 *
 * Die Begruendung fuer Erweiterungen statt Schnittstellen-Delegation steht in
 * BrickRepository.kt.
 */

suspend fun BrickRepository.getSetPrice(setNumber: String): Result<SetPriceResponse> =
    safeCall { api.getSetPrice(setNumber) }

suspend fun BrickRepository.getSetPriceHistory(setNumber: String): Result<PriceHistoryResponse> =
    safeCall { api.getSetPriceHistory(setNumber) }

suspend fun BrickRepository.getPartsValuation(accounts: String? = null): Result<PartsValuationResponse> =
    safeCall { api.getPartsValuation(accounts) }

suspend fun BrickRepository.getMinifigsValuation(accounts: String? = null): Result<FigsValuationResponse> =
    safeCall { api.getMinifigsValuation(accounts) }

suspend fun BrickRepository.getPnl(accounts: String? = null): Result<PnlResponse> =
    safeCall { api.getPnl(accounts) }

suspend fun BrickRepository.getValuation(accounts: String? = null): Result<ValuationResponse> =
    safeCall { api.getValuation(accounts) }

suspend fun BrickRepository.getStats(accounts: String? = null): Result<StatsResponse> =
    if (accounts == null)
        cached("stats", StatsResponse.serializer()) { safeCall { api.getStats() } }
    else safeCall { api.getStats(accounts) }

suspend fun BrickRepository.getPortfolioHistory(period: String = "week", accounts: String? = null): Result<PortfolioHistoryResponse> =
    safeCall { api.getPortfolioHistory(period, accounts) }

suspend fun BrickRepository.getPartPriceHistory(partNumber: String, colorId: Int): Result<PriceHistoryResponse> =
    safeCall { api.getPartPriceHistory(partNumber, colorId) }

suspend fun BrickRepository.getFigPriceHistory(figNumber: String): Result<PriceHistoryResponse> =
    safeCall { api.getFigPriceHistory(figNumber) }

suspend fun BrickRepository.triggerPriceJob(): Result<GenericAdminResponse> = safeCall { api.triggerPriceJob() }
