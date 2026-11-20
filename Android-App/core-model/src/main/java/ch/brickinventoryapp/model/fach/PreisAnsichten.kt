package ch.brickinventoryapp.model.fach

// Marktpreise und ihr Verlauf je Zustand.

data class PreisDiagrammAnsicht(
    val values: List<PriceSeriesView> = emptyList(),
    val x: List<String> = emptyList(),
)

data class PriceSeriesView(
    val name: String = "",
    val values: List<PricePointView> = emptyList(),
    val firstRealIndex: Int = 0,
)

data class PricePointView(
    val x: String = "",
    val preis: Geld = Geld.NULL,
)

data class PricePerStateView(
    val new: StateValuationView? = null,
    val used: StateValuationView? = null,
) {
    /** Die Zustände, zu denen es eine Bewertung gibt, neu zuerst. */
    fun present(): List<Pair<Zustand, StateValuationView>> = buildList {
        new?.let { add(Zustand.NEU to it) }
        used?.let { add(Zustand.GEBRAUCHT to it) }
    }
}

data class StateValuationView(
    val marketPrice: Geld? = null,
    val purchasePrice: Geld? = null,
    val pnlPct: Double? = null,
)

data class PriceHistoryView(
    val currency: Waehrung = Waehrung.KEINE,
    val historyNew: List<PriceHistoryPointView> = emptyList(),
    val historyUsed: List<PriceHistoryPointView> = emptyList(),
    val byCondition: PricePerStateView = PricePerStateView(),
    val chart: PreisDiagrammAnsicht = PreisDiagrammAnsicht(),
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val purchasePrice: Geld? = null,
)

data class PriceHistoryPointView(
    val qtyAvgPrice: Geld? = null,
    val avgPrice: Geld? = null,
)

data class SetPriceView(
    val setNumber: String = "",
    val currency: Waehrung = Waehrung.KEINE,
    val avgPrice: Geld? = null,
    val qtyAvgPrice: Geld? = null,
    val noPrice: Boolean = false,
)

data class CurrentPriceView(
    val condition: Zustand? = null,
    val avgPrice: Geld? = null,
)

data class CurrentPerStateView(
    val new: CurrentPriceView? = null,
    val used: CurrentPriceView? = null,
)

data class WantedItemPricesView(
    val currency: Waehrung = Waehrung.KEINE,
    val current: CurrentPerStateView = CurrentPerStateView(),
)
