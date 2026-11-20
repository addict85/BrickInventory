package ch.brickinventoryapp.model.domain

import java.time.Instant

// Bewertung, Gewinn und Kennzahlen; Beträge kommen fertig vom Server.

data class MetricsView(
    val totalSets: Int,
    val totalQuantity: Int,
    val totalInstructions: Int,
    val totalParts: Int,
    val totalMinifigs: Int,
    val partsFromSets: Int? = null,
    val partsSingle: Int? = null,
)

data class TeileBewertungAnsicht(
    val currency: Waehrung = Waehrung.EUR,
    val parts: List<ManualPartView> = emptyList(),
    val totalValue: String,
    val kaufpreiseFremdeWaehrung: Int = 0,
)

data class FigurenBewertungAnsicht(
    val currency: Waehrung = Waehrung.EUR,
    val figs: List<ManualMinifigView> = emptyList(),
    val totalValue: String,
    val kaufpreiseFremdeWaehrung: Int = 0,
)

data class GewinnAnsicht(
    val currency: Waehrung = Waehrung.EUR,
    val totals: GainSumsView,
    val sets: List<GainRowView> = emptyList(),
)

data class GainRowView(
    val setNumber: String,
    val quantity: Int = 1,
    val currentPrice: Geld? = null,
    val baselinePrice: Geld? = null,
    val pnlPct: String? = null,
    val baselinePnlPct: String? = null,
    val pnlBetrag: Geld? = null,
    val pnlProzent: Double? = null,
    val baselinePnlProzent: Double? = null,
    val kachelPreis: Geld? = null,
    val kachelPnlPct: Double? = null,
    val kachelQuelle: String? = null,
)

data class GainSumsView(
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
    val sets: List<ValuationSetView> = emptyList(),
    val totals: SumsView = SumsView(),
)

data class ValuationSetView(
    val setNumber: String,
    val addedAt: Instant? = null,
    val name: String? = null,
    val year: Int? = null,
    val quantity: Int = 1,
    val imageLocal: String? = null,
    val imageUrl: String? = null,
    val avgPrice: Geld? = null,
    val qtyAvgPrice: Geld? = null,
    val totalQtyAvg: String? = null,
    val totalAvg: String? = null,
    val wertGesamt: Geld? = null,
    val pnlProzent: Double? = null,
    val purchasePrice: Geld? = null,
    val noPrice: Boolean = false,
    val acquisitions: List<ValuationPurchaseView> = emptyList(),
    val mixed: Boolean = false,
    /** Warum zu diesem Set kein Preis da ist; null, wenn es einen gibt. */
    val error: String? = null,
)

data class SumsView(
    val min: String = "0.00",
    val avg: String = "0.00",
    val max: String = "0.00",
)
