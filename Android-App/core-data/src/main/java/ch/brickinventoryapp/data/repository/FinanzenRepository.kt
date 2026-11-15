package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.BewertungAnsicht
import ch.brickinventoryapp.model.fach.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.fach.GewinnAnsicht
import ch.brickinventoryapp.model.fach.KennzahlenAnsicht
import ch.brickinventoryapp.model.fach.PreisverlaufAnsicht
import ch.brickinventoryapp.model.fach.SetPreisAnsicht
import ch.brickinventoryapp.model.fach.TeileBewertungAnsicht
import ch.brickinventoryapp.model.fach.WertverlaufAnsicht

import ch.brickinventoryapp.model.fach.Kontoauswahl
/**
 * Preise, Bewertung, Verlauf und Gewinn/Verlust.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (FinanzenRepositoryImpl).
 */
interface FinanzenRepository {
    suspend fun getSetPrice(setNumber: String): Ergebnis<SetPreisAnsicht>

    suspend fun getSetPriceHistory(setNumber: String): Ergebnis<PreisverlaufAnsicht>

    suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Ergebnis<PreisverlaufAnsicht>

    suspend fun getFigPriceHistory(figNumber: String): Ergebnis<PreisverlaufAnsicht>

    suspend fun getPartsValuation(konten: Kontoauswahl? = null): Ergebnis<TeileBewertungAnsicht>

    suspend fun getMinifigsValuation(konten: Kontoauswahl? = null): Ergebnis<FigurenBewertungAnsicht>

    suspend fun getValuation(konten: Kontoauswahl? = null): Ergebnis<BewertungAnsicht>

    suspend fun getPnl(konten: Kontoauswahl? = null): Ergebnis<GewinnAnsicht>

    suspend fun getPortfolioHistory(period: String = "week", konten: Kontoauswahl? = null): Ergebnis<WertverlaufAnsicht>

    suspend fun getStats(konten: Kontoauswahl? = null): Ergebnis<KennzahlenAnsicht?>
}
