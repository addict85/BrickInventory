package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Kontoauswahl
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

    override suspend fun getPartsValuation(konten: Kontoauswahl?): Ergebnis<PartsValuationResponse> =
        sicherAufrufen { api.getPartsValuation(konten?.anfrage) }

    override suspend fun getMinifigsValuation(konten: Kontoauswahl?): Ergebnis<FigsValuationResponse> =
        sicherAufrufen { api.getMinifigsValuation(konten?.anfrage) }

    override suspend fun getValuation(konten: Kontoauswahl?): Ergebnis<ValuationResponse> =
        sicherAufrufen { api.getValuation(konten?.anfrage) }

    override suspend fun getPnl(konten: Kontoauswahl?): Ergebnis<PnlResponse> =
        sicherAufrufen { api.getPnl(konten?.anfrage) }

    override suspend fun getPortfolioHistory(period: String, konten: Kontoauswahl?): Ergebnis<PortfolioHistoryResponse> =
        sicherAufrufen { api.getPortfolioHistory(period, konten?.anfrage) }

    override suspend fun getStats(konten: Kontoauswahl?): Ergebnis<StatsResponse> =
        if (konten == null)
            cache.cached("stats", StatsResponse.serializer()) { sicherAufrufen { api.getStats() } }
        else sicherAufrufen { api.getStats(konten.anfrage) }
}
