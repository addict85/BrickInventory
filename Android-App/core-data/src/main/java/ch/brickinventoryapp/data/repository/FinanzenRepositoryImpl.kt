package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.FinanzenApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust — über Retrofit; die gemeinsame Abruflogik steht in RepoBasis.kt.
 */
@Singleton
class FinanzenRepositoryImpl @Inject constructor(
    api: FinanzenApi,
    cache: ResponseCache,
) : RepoBasis<FinanzenApi>(api, cache), FinanzenRepository {

    override suspend fun getSetPrice(setNumber: String): Result<SetPriceResponse> =
        safeCall { api.getSetPrice(setNumber) }

    override suspend fun getSetPriceHistory(setNumber: String): Result<PriceHistoryResponse> =
        safeCall { api.getSetPriceHistory(setNumber) }

    override suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Result<PriceHistoryResponse> =
        safeCall { api.getPartPriceHistory(partNumber, colorId) }

    override suspend fun getFigPriceHistory(figNumber: String): Result<PriceHistoryResponse> =
        safeCall { api.getFigPriceHistory(figNumber) }

    override suspend fun getPartsValuation(accounts: String?): Result<PartsValuationResponse> =
        safeCall { api.getPartsValuation(accounts) }

    override suspend fun getMinifigsValuation(accounts: String?): Result<FigsValuationResponse> =
        safeCall { api.getMinifigsValuation(accounts) }

    override suspend fun getValuation(accounts: String?): Result<ValuationResponse> =
        safeCall { api.getValuation(accounts) }

    override suspend fun getPnl(accounts: String?): Result<PnlResponse> =
        safeCall { api.getPnl(accounts) }

    override suspend fun getPortfolioHistory(period: String, accounts: String?): Result<PortfolioHistoryResponse> =
        safeCall { api.getPortfolioHistory(period, accounts) }

    override suspend fun getStats(accounts: String?): Result<StatsResponse> =
        if (accounts == null)
            cached("stats", StatsResponse.serializer()) { safeCall { api.getStats() } }
        else safeCall { api.getStats(accounts) }
}
