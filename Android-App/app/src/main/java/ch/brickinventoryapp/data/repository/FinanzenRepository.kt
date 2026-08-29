package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
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
 * Teil der Aufteilung von BrickRepository (Nachtrag 155) — die Begruendung
 * steht in RepoBasis.kt. Die Ruempfe sind WORTGLEICH uebernommen; veraendert
 * wurde nichts ausser der Klassenzugehoerigkeit.
 *
 * Erreichbar ueber `repo.finanzen.…` — BrickRepository haelt die fuenf Teile.
 */
@Singleton
class FinanzenRepository @Inject constructor(
    api: BrickApiService,
    cache: ResponseCache,
) : RepoBasis(api, cache) {

    suspend fun getSetPrice(setNumber: String): Result<SetPriceResponse> =
        safeCall { api.getSetPrice(setNumber) }

    suspend fun getSetPriceHistory(setNumber: String): Result<PriceHistoryResponse> =
        safeCall { api.getSetPriceHistory(setNumber) }

    suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Result<PriceHistoryResponse> =
        safeCall { api.getPartPriceHistory(partNumber, colorId) }

    suspend fun getFigPriceHistory(figNumber: String): Result<PriceHistoryResponse> =
        safeCall { api.getFigPriceHistory(figNumber) }

    suspend fun getPartsValuation(accounts: String? = null): Result<PartsValuationResponse> =
        safeCall { api.getPartsValuation(accounts) }

    suspend fun getMinifigsValuation(accounts: String? = null): Result<FigsValuationResponse> =
        safeCall { api.getMinifigsValuation(accounts) }

    suspend fun getValuation(accounts: String? = null): Result<ValuationResponse> =
        safeCall { api.getValuation(accounts) }

    suspend fun getPnl(accounts: String? = null): Result<PnlResponse> =
        safeCall { api.getPnl(accounts) }

    suspend fun getPortfolioHistory(period: String = "week", accounts: String? = null): Result<PortfolioHistoryResponse> =
        safeCall { api.getPortfolioHistory(period, accounts) }

    suspend fun getStats(accounts: String? = null): Result<StatsResponse> =
        if (accounts == null)
            cached("stats", StatsResponse.serializer()) { safeCall { api.getStats() } }
        else safeCall { api.getStats(accounts) }

    suspend fun triggerPriceJob(): Result<GenericAdminResponse> = safeCall { api.triggerPriceJob() }
}
