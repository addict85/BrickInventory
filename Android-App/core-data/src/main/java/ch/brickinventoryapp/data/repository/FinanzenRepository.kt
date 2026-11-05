package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.model.*

/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (FinanzenRepositoryImpl).
 */
interface FinanzenRepository {
    suspend fun getSetPrice(setNumber: String): Result<SetPriceResponse>

    suspend fun getSetPriceHistory(setNumber: String): Result<PriceHistoryResponse>

    suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Result<PriceHistoryResponse>

    suspend fun getFigPriceHistory(figNumber: String): Result<PriceHistoryResponse>

    suspend fun getPartsValuation(accounts: String? = null): Result<PartsValuationResponse>

    suspend fun getMinifigsValuation(accounts: String? = null): Result<FigsValuationResponse>

    suspend fun getValuation(accounts: String? = null): Result<ValuationResponse>

    suspend fun getPnl(accounts: String? = null): Result<PnlResponse>

    suspend fun getPortfolioHistory(period: String = "week", accounts: String? = null): Result<PortfolioHistoryResponse>

    suspend fun getStats(accounts: String? = null): Result<StatsResponse>
}
