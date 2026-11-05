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

    override suspend fun getSetPrice(setNumber: String): Ergebnis<SetPriceResponse> =
        safeCall { api.getSetPrice(setNumber) }

    override suspend fun getSetPriceHistory(setNumber: String): Ergebnis<PriceHistoryResponse> =
        safeCall { api.getSetPriceHistory(setNumber) }

    override suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Ergebnis<PriceHistoryResponse> =
        safeCall { api.getPartPriceHistory(partNumber, colorId) }

    override suspend fun getFigPriceHistory(figNumber: String): Ergebnis<PriceHistoryResponse> =
        safeCall { api.getFigPriceHistory(figNumber) }

    override suspend fun getPartsValuation(accounts: String?): Ergebnis<PartsValuationResponse> =
        safeCall { api.getPartsValuation(accounts) }

    override suspend fun getMinifigsValuation(accounts: String?): Ergebnis<FigsValuationResponse> =
        safeCall { api.getMinifigsValuation(accounts) }

    override suspend fun getValuation(accounts: String?): Ergebnis<ValuationResponse> =
        safeCall { api.getValuation(accounts) }

    override suspend fun getPnl(accounts: String?): Ergebnis<PnlResponse> =
        safeCall { api.getPnl(accounts) }

    override suspend fun getPortfolioHistory(period: String, accounts: String?): Ergebnis<PortfolioHistoryResponse> =
        safeCall { api.getPortfolioHistory(period, accounts) }

    override suspend fun getStats(accounts: String?): Ergebnis<StatsResponse> =
        if (accounts == null)
            cached("stats", StatsResponse.serializer()) { safeCall { api.getStats() } }
        else safeCall { api.getStats(accounts) }
}
