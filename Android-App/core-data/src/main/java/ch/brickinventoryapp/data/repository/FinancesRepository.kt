package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.BewertungAnsicht
import ch.brickinventoryapp.model.domain.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.domain.GewinnAnsicht
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.PriceHistoryView
import ch.brickinventoryapp.model.domain.SetPriceView
import ch.brickinventoryapp.model.domain.TeileBewertungAnsicht
import ch.brickinventoryapp.model.domain.ValueHistoryView

import ch.brickinventoryapp.model.domain.Kontoauswahl
/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (FinanzenRepositoryImpl).
 */
interface FinancesRepository {
    suspend fun getSetPrice(setNumber: String): Ergebnis<SetPriceView>

    suspend fun getSetPriceHistory(setNumber: String): Ergebnis<PriceHistoryView>

    suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Ergebnis<PriceHistoryView>

    suspend fun getFigPriceHistory(figNumber: String): Ergebnis<PriceHistoryView>

    suspend fun getPartsValuation(konten: Kontoauswahl? = null): Ergebnis<TeileBewertungAnsicht>

    suspend fun getMinifigsValuation(konten: Kontoauswahl? = null): Ergebnis<FigurenBewertungAnsicht>

    suspend fun getValuation(konten: Kontoauswahl? = null): Ergebnis<BewertungAnsicht>

    suspend fun getPnl(konten: Kontoauswahl? = null): Ergebnis<GewinnAnsicht>

    suspend fun getPortfolioHistory(period: String = "week", konten: Kontoauswahl? = null): Ergebnis<ValueHistoryView>

    suspend fun getStats(konten: Kontoauswahl? = null): Ergebnis<MetricsView?>
}
