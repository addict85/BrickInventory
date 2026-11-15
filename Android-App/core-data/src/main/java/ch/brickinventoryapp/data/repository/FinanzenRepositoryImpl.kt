package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.BewertungAnsicht
import ch.brickinventoryapp.model.fach.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.fach.GewinnAnsicht
import ch.brickinventoryapp.model.fach.KennzahlenAnsicht
import ch.brickinventoryapp.model.fach.PreisverlaufAnsicht
import ch.brickinventoryapp.model.fach.SetPreisAnsicht
import ch.brickinventoryapp.model.fach.TeileBewertungAnsicht
import ch.brickinventoryapp.model.fach.WertverlaufAnsicht
import ch.brickinventoryapp.vertrag.PriceHistoryResponse
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht

import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.data.api.FinanzenApi
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class FinanzenRepositoryImpl @Inject constructor(
    private val api: FinanzenApi,
    private val ablage: Offlineablage,
) : FinanzenRepository {

    override suspend fun getSetPrice(setNumber: String): Ergebnis<SetPreisAnsicht> =
        sicherAufrufen { api.getSetPrice(setNumber) }.abgebildet { it.alsAnsicht() }

    override suspend fun getSetPriceHistory(setNumber: String): Ergebnis<PreisverlaufAnsicht> =
        sicherAufrufen { api.getSetPriceHistory(setNumber) }.verlauf()

    override suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Ergebnis<PreisverlaufAnsicht> =
        sicherAufrufen { api.getPartPriceHistory(partNumber, colorId) }.verlauf()

    override suspend fun getFigPriceHistory(figNumber: String): Ergebnis<PreisverlaufAnsicht> =
        sicherAufrufen { api.getFigPriceHistory(figNumber) }.verlauf()

    override suspend fun getPartsValuation(konten: Kontoauswahl?): Ergebnis<TeileBewertungAnsicht> =
        sicherAufrufen { api.getPartsValuation(konten?.anfrage) }.abgebildet { it.alsAnsicht() }

    override suspend fun getMinifigsValuation(konten: Kontoauswahl?): Ergebnis<FigurenBewertungAnsicht> =
        sicherAufrufen { api.getMinifigsValuation(konten?.anfrage) }.abgebildet { it.alsAnsicht() }

    override suspend fun getValuation(konten: Kontoauswahl?): Ergebnis<BewertungAnsicht> =
        sicherAufrufen { api.getValuation(konten?.anfrage) }.abgebildet { it.alsAnsicht() }

    override suspend fun getPnl(konten: Kontoauswahl?): Ergebnis<GewinnAnsicht> =
        sicherAufrufen { api.getPnl(konten?.anfrage) }.abgebildet { it.alsAnsicht() }

    override suspend fun getPortfolioHistory(period: String, konten: Kontoauswahl?): Ergebnis<WertverlaufAnsicht> =
        sicherAufrufen { api.getPortfolioHistory(period, konten?.anfrage) }.abgebildet { it.alsAnsicht() }

    override suspend fun getStats(konten: Kontoauswahl?): Ergebnis<KennzahlenAnsicht?> =
        (if (konten == null)
            ablage.abgeglichenEinzeln(Faecher.KENNZAHLEN) { sicherAufrufen { api.getStats() }.abgebildet { it.stats?.alsAnsicht() } }
        else sicherAufrufen { api.getStats(konten.anfrage) }.abgebildet { it.stats?.alsAnsicht() })
}

/** Ein Verlauf mit success: false hat keine Punkte, die etwas sagten. */
private fun Ergebnis<PriceHistoryResponse>.verlauf(): Ergebnis<PreisverlaufAnsicht> =
    zugesagt({ it.success }, { null }) { it.alsAnsicht() }
