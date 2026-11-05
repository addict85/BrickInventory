package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.model.*

/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (FinanzenRepositoryImpl).
 */
interface FinanzenRepository {
    suspend fun getSetPrice(setNumber: String): Ergebnis<SetPriceResponse>

    suspend fun getSetPriceHistory(setNumber: String): Ergebnis<PriceHistoryResponse>

    suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Ergebnis<PriceHistoryResponse>

    suspend fun getFigPriceHistory(figNumber: String): Ergebnis<PriceHistoryResponse>

    suspend fun getPartsValuation(accounts: String? = null): Ergebnis<PartsValuationResponse>

    suspend fun getMinifigsValuation(accounts: String? = null): Ergebnis<FigsValuationResponse>

    suspend fun getValuation(accounts: String? = null): Ergebnis<ValuationResponse>

    suspend fun getPnl(accounts: String? = null): Ergebnis<PnlResponse>

    suspend fun getPortfolioHistory(period: String = "week", accounts: String? = null): Ergebnis<PortfolioHistoryResponse>

    suspend fun getStats(accounts: String? = null): Ergebnis<StatsResponse>
}
