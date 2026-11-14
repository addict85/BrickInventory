package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.vertrag.FigsValuationResponse
import ch.brickinventoryapp.vertrag.PartsValuationResponse
import ch.brickinventoryapp.vertrag.PnlResponse
import ch.brickinventoryapp.vertrag.PortfolioHistoryResponse
import ch.brickinventoryapp.vertrag.PriceHistoryResponse
import ch.brickinventoryapp.vertrag.SetPriceResponse
import ch.brickinventoryapp.vertrag.StatsResponse
import ch.brickinventoryapp.vertrag.ValuationResponse
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

    suspend fun getPartsValuation(konten: Kontoauswahl? = null): Ergebnis<PartsValuationResponse>

    suspend fun getMinifigsValuation(konten: Kontoauswahl? = null): Ergebnis<FigsValuationResponse>

    suspend fun getValuation(konten: Kontoauswahl? = null): Ergebnis<ValuationResponse>

    suspend fun getPnl(konten: Kontoauswahl? = null): Ergebnis<PnlResponse>

    suspend fun getPortfolioHistory(period: String = "week", konten: Kontoauswahl? = null): Ergebnis<PortfolioHistoryResponse>

    suspend fun getStats(konten: Kontoauswahl? = null): Ergebnis<StatsResponse>
}
