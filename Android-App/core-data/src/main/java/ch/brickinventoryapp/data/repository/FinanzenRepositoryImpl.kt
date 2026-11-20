package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.BewertungAnsicht
import ch.brickinventoryapp.model.fach.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.fach.GewinnAnsicht
import ch.brickinventoryapp.model.fach.MetricsView
import ch.brickinventoryapp.model.fach.PriceHistoryView
import ch.brickinventoryapp.model.fach.SetPriceView
import ch.brickinventoryapp.model.fach.TeileBewertungAnsicht
import ch.brickinventoryapp.model.fach.ValueHistoryView
import ch.brickinventoryapp.vertrag.PriceHistoryResponse
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht

import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.data.api.FinancesApi
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class FinanzenRepositoryImpl @Inject constructor(
    private val api: FinancesApi,
    private val ablage: Offlineablage,
) : FinancesRepository {

    override suspend fun getSetPrice(setNumber: String): Ergebnis<SetPriceView> =
        sicherAufrufen { api.getSetPrice(setNumber) }.shown { it.alsAnsicht() }

    override suspend fun getSetPriceHistory(setNumber: String): Ergebnis<PriceHistoryView> =
        sicherAufrufen { api.getSetPriceHistory(setNumber) }.verlauf()

    override suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Ergebnis<PriceHistoryView> =
        sicherAufrufen { api.getPartPriceHistory(partNumber, colorId) }.verlauf()

    override suspend fun getFigPriceHistory(figNumber: String): Ergebnis<PriceHistoryView> =
        sicherAufrufen { api.getFigPriceHistory(figNumber) }.verlauf()

    override suspend fun getPartsValuation(konten: Kontoauswahl?): Ergebnis<TeileBewertungAnsicht> =
        sicherAufrufen { api.getPartsValuation(konten?.anfrage) }.shown { it.alsAnsicht() }

    override suspend fun getMinifigsValuation(konten: Kontoauswahl?): Ergebnis<FigurenBewertungAnsicht> =
        sicherAufrufen { api.getMinifigsValuation(konten?.anfrage) }.shown { it.alsAnsicht() }

    override suspend fun getValuation(konten: Kontoauswahl?): Ergebnis<BewertungAnsicht> =
        sicherAufrufen { api.getValuation(konten?.anfrage) }.shown { it.alsAnsicht() }

    override suspend fun getPnl(konten: Kontoauswahl?): Ergebnis<GewinnAnsicht> =
        sicherAufrufen { api.getPnl(konten?.anfrage) }.shown { it.alsAnsicht() }

    override suspend fun getPortfolioHistory(period: String, konten: Kontoauswahl?): Ergebnis<ValueHistoryView> =
        sicherAufrufen { api.getPortfolioHistory(period, konten?.anfrage) }.shown { it.alsAnsicht() }

    override suspend fun getStats(konten: Kontoauswahl?): Ergebnis<MetricsView?> =
        (if (konten == null)
            ablage.reconciledSingle(Slots.KENNZAHLEN) { sicherAufrufen { api.getStats() }.shown { it.stats?.alsAnsicht() } }
        else sicherAufrufen { api.getStats(konten.anfrage) }.shown { it.stats?.alsAnsicht() })
}

/** Ein Verlauf mit success: false hat keine Punkte, die etwas sagten. */
private fun Ergebnis<PriceHistoryResponse>.verlauf(): Ergebnis<PriceHistoryView> =
    promised({ it.success }, { null }) { it.alsAnsicht() }
