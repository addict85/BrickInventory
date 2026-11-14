package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand

// Bewertung, Gewinn und Kennzahlen; Beträge kommen fertig vom Server.

data class KennzahlenAnsicht(
    val totalSets: Int,
    val totalQuantity: Int,
    val totalInstructions: Int,
    val totalParts: Int,
    val totalMinifigs: Int,
    val teileAusSets: Int? = null,
    val teileEinzeln: Int? = null,
)

data class TeileBewertungAnsicht(
    val currency: Waehrung = Waehrung.EUR,
    val parts: List<ManuellesTeilAnsicht> = emptyList(),
    val totalValue: String,
    val kaufpreiseFremdeWaehrung: Int = 0,
)

data class FigurenBewertungAnsicht(
    val currency: Waehrung = Waehrung.EUR,
    val figs: List<ManuelleFigurAnsicht> = emptyList(),
    val totalValue: String,
    val kaufpreiseFremdeWaehrung: Int = 0,
)

data class GewinnAnsicht(
    val currency: Waehrung = Waehrung.EUR,
    val totals: GewinnSummenAnsicht,
    val sets: List<GewinnZeileAnsicht> = emptyList(),
)

data class GewinnZeileAnsicht(
    val setNumber: String,
    val quantity: Int = 1,
    val currentPrice: Double? = null,
    val baselinePrice: Double? = null,
    val pnlPct: String? = null,
    val baselinePnlPct: String? = null,
    val pnlBetrag: Double? = null,
    val pnlProzent: Double? = null,
    val baselinePnlProzent: Double? = null,
    val kachelPreis: Double? = null,
    val kachelPnlPct: Double? = null,
    val kachelQuelle: String? = null,
)

data class GewinnSummenAnsicht(
    val purchase: String,
    val current: String,
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val kaufpreiseFremdeWaehrung: Int = 0,
    val grandTotal: String? = null,
    val positionen: Int? = null,
    val positionenBewertet: Int? = null,
    val positionenOhneMarktpreis: Int? = null,
    val positionenOhneKaufpreis: Int? = null,
    val basisEinstand: String? = null,
    val basisMarktwert: String? = null,
    val basisGuvBetrag: String? = null,
    val ohneMarktpreisEinstand: String? = null,
    val ohneKaufpreisMarktwert: String? = null,
)

data class BewertungAnsicht(
    val currency: Waehrung = Waehrung.EUR,
    val condition: Zustand = Zustand.NEU,
    val ttlStunden: Int? = null,
    val kaufpreiseFremdeWaehrung: Int = 0,
    val sets: List<BewertungSetAnsicht> = emptyList(),
    val totals: SummenAnsicht = SummenAnsicht(),
)

data class BewertungSetAnsicht(
    val setNumber: String,
    val addedAt: String? = null,
    val name: String? = null,
    val year: Int? = null,
    val quantity: Int = 1,
    val imageLocal: String? = null,
    val imageUrl: String? = null,
    val avgPrice: Double? = null,
    val qtyAvgPrice: Double? = null,
    val totalQtyAvg: String? = null,
    val totalAvg: String? = null,
    val wertGesamt: Double? = null,
    val pnlProzent: Double? = null,
    val purchasePrice: Double? = null,
    val noPrice: Boolean = false,
    val acquisitions: List<BewertungsKaufAnsicht> = emptyList(),
    val mixed: Boolean = false,
    /** Warum zu diesem Set kein Preis da ist; null, wenn es einen gibt. */
    val error: String? = null,
)

data class SummenAnsicht(
    val min: String = "0.00",
    val avg: String = "0.00",
    val max: String = "0.00",
)
