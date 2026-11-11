package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.FinanzenApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.model.data.model.*
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class FinanzenRepositoryImpl @Inject constructor(
    private val api: FinanzenApi,
    private val cache: ResponseCache,
) : FinanzenRepository {

    override suspend fun getSetPrice(setNumber: String): Ergebnis<SetPriceResponse> =
        sicherAufrufen { api.getSetPrice(setNumber) }

    override suspend fun getSetPriceHistory(setNumber: String): Ergebnis<PriceHistoryResponse> =
        sicherAufrufen { api.getSetPriceHistory(setNumber) }

    override suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Ergebnis<PriceHistoryResponse> =
        sicherAufrufen { api.getPartPriceHistory(partNumber, colorId) }

    override suspend fun getFigPriceHistory(figNumber: String): Ergebnis<PriceHistoryResponse> =
        sicherAufrufen { api.getFigPriceHistory(figNumber) }

    override suspend fun getPartsValuation(accounts: String?): Ergebnis<PartsValuationResponse> =
        sicherAufrufen { api.getPartsValuation(accounts) }

    override suspend fun getMinifigsValuation(accounts: String?): Ergebnis<FigsValuationResponse> =
        sicherAufrufen { api.getMinifigsValuation(accounts) }

    override suspend fun getValuation(accounts: String?): Ergebnis<ValuationResponse> =
        sicherAufrufen { api.getValuation(accounts) }

    override suspend fun getPnl(accounts: String?): Ergebnis<PnlResponse> =
        sicherAufrufen { api.getPnl(accounts) }

    override suspend fun getPortfolioHistory(period: String, accounts: String?): Ergebnis<PortfolioHistoryResponse> =
        sicherAufrufen { api.getPortfolioHistory(period, accounts) }

    override suspend fun getStats(accounts: String?): Ergebnis<StatsResponse> =
        if (accounts == null)
            cache.cached("stats", StatsResponse.serializer()) { sicherAufrufen { api.getStats() } }
        else sicherAufrufen { api.getStats(accounts) }
}
