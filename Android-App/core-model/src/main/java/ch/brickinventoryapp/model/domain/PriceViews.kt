package ch.brickinventoryapp.model.domain

// Market prices and their history per condition.

data class PriceChartView(
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
    val price: Money = Money.NULL,
)

data class PricePerStateView(
    val new: StateValuationView? = null,
    val used: StateValuationView? = null,
) {
    /** The conditions for which there is a valuation, new first. */
    fun present(): List<Pair<Condition, StateValuationView>> = buildList {
        new?.let { add(Condition.NEW to it) }
        used?.let { add(Condition.USED to it) }
    }
}

data class StateValuationView(
    val marketPrice: Money? = null,
    val purchasePrice: Money? = null,
    val pnlPct: Double? = null,
)

data class PriceHistoryView(
    val currency: CurrencyCode = CurrencyCode.NONE,
    val historyNew: List<PriceHistoryPointView> = emptyList(),
    val historyUsed: List<PriceHistoryPointView> = emptyList(),
    val byCondition: PricePerStateView = PricePerStateView(),
    val chart: PriceChartView = PriceChartView(),
    val pnlPct: String? = null,
    val pnlPercent: Double? = null,
    val purchasePrice: Money? = null,
)

data class PriceHistoryPointView(
    val qtyAvgPrice: Money? = null,
    val avgPrice: Money? = null,
)

data class SetPriceView(
    val setNumber: String = "",
    val currency: CurrencyCode = CurrencyCode.NONE,
    val avgPrice: Money? = null,
    val qtyAvgPrice: Money? = null,
    val noPrice: Boolean = false,
)

data class CurrentPriceView(
    val condition: Condition? = null,
    val avgPrice: Money? = null,
)

data class CurrentPerStateView(
    val new: CurrentPriceView? = null,
    val used: CurrentPriceView? = null,
)

data class WantedItemPricesView(
    val currency: CurrencyCode = CurrencyCode.NONE,
    val current: CurrentPerStateView = CurrentPerStateView(),
)
