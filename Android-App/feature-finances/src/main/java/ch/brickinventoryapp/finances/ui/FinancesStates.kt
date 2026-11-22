package ch.brickinventoryapp.finances.ui

import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.PlaintextView
import ch.brickinventoryapp.model.domain.ValuationView
import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.PricePoint
import ch.brickinventoryapp.model.domain.FiguresValuationView
import ch.brickinventoryapp.model.domain.ProfitView
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.PartsValuationView
import ch.brickinventoryapp.model.ui.Load

/**
 * Finances: valuation, profit/loss and portfolio history — its own flow because
 * the history is cleared and reloaded when the period changes, and that
 * would otherwise redraw the whole app.
 */
data class FinanceUiState(
    val valuation: ValuationView? = null,
    val partsValuation: PartsValuationView? = null,
    val figsValuation: FiguresValuationView? = null,
    val pnl: ProfitView? = null,
    /**
     * The fetch of the valuation, separate from the history: a shared loading state ended
     * other displays. Without the error the tab showed „keine Preisdaten“.
     */
    val valuationLoad: Load<Unit> = Load.Data(Unit),
    val history: Load<Unit> = Load.Data(Unit),
    val historyPeriodChangePct: Double? = null,
    /**
     * Points and axis, as the server sends them. They are only translated when
     * drawn (FinanceScreen): the language at load time is not the one at display time.
     */
    val historyPoints: List<PricePoint> = emptyList(),
    val historyYAxis: List<ChartAxis> = emptyList(),
    /** The ISO day of each point (chart.x) — the local x-axis is built from this. */
    val historyDays: List<String> = emptyList(),
    /** Currency of the y-axis; null = that of the valuation. */
    val historyCurrency: CurrencyCode? = null,
    val historyPeriod: String = "week",
    /**
     * Which row kinds the tab shows: "sets", "parts", "figs". In the state and
     * not in the screen, because a `remember` does not survive navigating into a
     * detail (like the list filters, ListFilterInStateTest). A set, so that
     * kinds can be combined; empty means all — so no list
     * needs to be fetched when a kind is added.
     */
    val categories: Set<String> = emptySet(),
) {
    /** Does the tab show this row kind? An empty selection means: all. */
    fun shows(category: String): Boolean = categories.isEmpty() || category in categories

    /**
     * Add or remove one row kind. Here instead of in the ViewModel, so that the
     * rule can be checked without an Android runtime.
     */
    fun withToggledCategory(category: String): FinanceUiState =
        copy(categories = if (category in categories) categories - category
                          else categories + category)
}

/**
 * Vouchers in one's own profile, in the settings as in the web app. The
 * revealed PINs stand as a set in the state: the PIN is hidden against the
 * shoulder next to it; what reveals it on screen is a state of the UI, the
 * voucher itself stays what the server sends.
 */
data class VoucherUiState(
    val vouchers: List<VoucherView> = emptyList(),
    /** An error stands in place of „keine Gutscheine“ as long as the list is empty. */
    val fetch: Load<Unit> = Load.Data(Unit),
    /** ids whose PIN is currently shown in plain text. */
    val pinVisible: Set<Int> = emptySet(),
    /** The voucher currently being edited; null = new entry. */
    val edited: Int? = null,
    // ── The form fields ──
    //
    // As strings, including the amount: while typing, „12,“ is neither a number
    // nor an error. What cannot be converted on saving is rejected by the server
    // (pruefeWerte in routes/api_v1/vouchers.ts).
    val number: String = "",
    val pin: String = "",
    val amount: String = "",
    val currency: String = "CHF",
    /** The chosen PDF file, for as long as it has not yet been uploaded. */
    val pdfName: String? = null,
    /**
     * The released PDF that the graph should open in the viewer, or null. In the
     * state instead of as a callback, because the graph knows the NavController; it acknowledges.
     */
    val pdfTarget: VoucherPdfTarget? = null,
    /** The running prompt for password and code, or null. */
    val confirmation: VoucherConfirmation? = null,
    /**
     * Number and PIN in plain text per id, for as long as the page is open. Only here, never
     * in the store or cache; GutscheineUnterseite clears it on leaving.
     */
    val plaintext: Map<Int, PlaintextView> = emptyMap(),
    /** What the UI should put on the clipboard; it acknowledges. */
    val copyTo: CopyJob? = null,
    val save: Operation = Operation.Done,
    /**
     * The id of the card whose balance is currently being queried, or null. An id instead of
     * a boolean, so that only the pressed button reacts — only one query ever
     * runs at a time.
     */
    val balanceRunning: Int? = null,
    /**
     * The run across all cards, or null. Separate from [balanceRunning]: that says
     * which card is up (spinner), this says that a pass is running (progress,
     * cancel).
     */
    val balanceRun: BalanceRun? = null,
)

/**
 * The sum of the vouchers, only for a SINGLE currency: amounts of different
 * currencies would give a number that looks correct and is not. In
 * BigDecimal, because the app forms this sum itself and 0.1 + 0.2 as a Double
 * is not 0.3.
 */
internal fun voucherSum(vouchers: List<VoucherView>): Pair<java.math.BigDecimal, CurrencyCode>? {
    val currency = vouchers.map { it.currency }.distinct().singleOrNull() ?: return null
    return vouchers.fold(java.math.BigDecimal.ZERO) { s, g -> s + g.amount.asBigDecimal() }
        .setScale(2, java.math.RoundingMode.HALF_UP) to currency
}

/**
 * The progress of a run across all cards: with one query every 30 seconds it
 * takes minutes, so it counts along and states the time remaining.
 */
data class BalanceRun(
    /** How many cards are already done (successful or not). */
    val done: Int = 0,
    val total: Int = 0,
    /** The card it is currently stuck on. */
    val number: String = "",
    /** Seconds until the next attempt, or 0 while the query runs. */
    val waitSec: Int = 0,
)

/** A released PDF; without [id] that of all vouchers. */
data class VoucherPdfTarget(val id: Int?, val ticket: String)

/** What only happens after the device lock and password. */
enum class VoucherStep { PIN_SHOW, NUMBER_COPY, PIN_COPY, PDF, EXPORT, DELETE }

/**
 * The password (and code) prompt, before [step] runs for voucher [id];
 * [id] is null for exporting all of them.
 */
data class VoucherConfirmation(
    val step: VoucherStep,
    val id: Int?,
    /** The server has asked for the second-factor code. */
    val codeNeeded: Boolean = false,
    val operation: Operation = Operation.Done,
)

data class CopyJob(val value: String, val isNumber: Boolean)
