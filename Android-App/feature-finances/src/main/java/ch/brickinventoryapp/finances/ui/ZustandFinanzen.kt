package ch.brickinventoryapp.finances.ui

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.PlaintextView
import ch.brickinventoryapp.model.domain.BewertungAnsicht
import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.DiagrammPunkt
import ch.brickinventoryapp.model.domain.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.domain.GewinnAnsicht
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.TeileBewertungAnsicht
import ch.brickinventoryapp.model.ui.Laden

/**
 * Finances: valuation, profit/loss and portfolio history — its own flow because
 * the history is cleared and reloaded when the period changes, and that
 * would otherwise redraw the whole app.
 */
data class FinanceUiState(
    val valuation: BewertungAnsicht? = null,
    val partsValuation: TeileBewertungAnsicht? = null,
    val figsValuation: FigurenBewertungAnsicht? = null,
    val pnl: GewinnAnsicht? = null,
    /**
     * The fetch of the valuation, separate from the history: a shared loading state ended
     * other displays. Without the error the tab showed „keine Preisdaten“.
     */
    val bewertung: Laden<Unit> = Laden.Daten(Unit),
    val verlauf: Laden<Unit> = Laden.Daten(Unit),
    val historyPeriodChangePct: Double? = null,
    /**
     * Points and axis, as the server sends them. They are only translated when
     * drawn (FinanceScreen): the language at load time is not the one at display time.
     */
    val historyPoints: List<DiagrammPunkt> = emptyList(),
    val historyYAxis: List<ChartAxis> = emptyList(),
    /** The ISO day of each point (chart.x) — the local x-axis is built from this. */
    val historyDays: List<String> = emptyList(),
    /** Currency of the y-axis; null = that of the valuation. */
    val historyCurrency: Waehrung? = null,
    val historyPeriod: String = "week",
    /**
     * Which row kinds the tab shows: "sets", "parts", "figs". In the state and
     * not in the screen, because a `remember` does not survive navigating into a
     * detail (like the list filters, ListenfilterInStateTest). A set, so that
     * kinds can be combined; empty means all — so no list
     * needs to be fetched when a kind is added.
     */
    val kategorien: Set<String> = emptySet(),
) {
    /** Does the tab show this row kind? An empty selection means: all. */
    fun zeigt(kategorie: String): Boolean = kategorien.isEmpty() || kategorie in kategorien

    /**
     * Add or remove one row kind. Here instead of in the ViewModel, so that the
     * rule can be checked without an Android runtime.
     */
    fun withToggledCategory(kategorie: String): FinanceUiState =
        copy(kategorien = if (kategorie in kategorien) kategorien - kategorie
                          else kategorien + kategorie)
}

/**
 * Vouchers in one's own profile, in the settings as in the web app. The
 * revealed PINs stand as a set in the state: the PIN is hidden against the
 * shoulder next to it; what reveals it on screen is a state of the UI, the
 * voucher itself stays what the server sends.
 */
data class GutscheinUiState(
    val gutscheine: List<VoucherView> = emptyList(),
    /** An error stands in place of „keine Gutscheine“ as long as the list is empty. */
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    /** ids whose PIN is currently shown in plain text. */
    val pinSichtbar: Set<Int> = emptySet(),
    /** The voucher currently being edited; null = new entry. */
    val edited: Int? = null,
    // ── The form fields ──
    //
    // As strings, including the amount: while typing, „12,“ is neither a number
    // nor an error. What cannot be converted on saving is rejected by the server
    // (pruefeWerte in routes/api_v1/vouchers.ts).
    val nummer: String = "",
    val pin: String = "",
    val betrag: String = "",
    val waehrung: String = "CHF",
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
    val klartext: Map<Int, PlaintextView> = emptyMap(),
    /** What the UI should put on the clipboard; it acknowledges. */
    val copyTo: CopyJob? = null,
    val speichern: Vorgang = Vorgang.Fertig,
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
internal fun voucherSum(gutscheine: List<VoucherView>): Pair<java.math.BigDecimal, Waehrung>? {
    val waehrung = gutscheine.map { it.currency }.distinct().singleOrNull() ?: return null
    return gutscheine.fold(java.math.BigDecimal.ZERO) { s, g -> s + g.amount.asBigDecimal() }
        .setScale(2, java.math.RoundingMode.HALF_UP) to waehrung
}

/**
 * The progress of a run across all cards: with one query every 30 seconds it
 * takes minutes, so it counts along and states the time remaining.
 */
data class BalanceRun(
    /** How many cards are already done (successful or not). */
    val erledigt: Int = 0,
    val gesamt: Int = 0,
    /** The card it is currently stuck on. */
    val nummer: String = "",
    /** Seconds until the next attempt, or 0 while the query runs. */
    val wartenSek: Int = 0,
)

/** A released PDF; without [id] that of all vouchers. */
data class VoucherPdfTarget(val id: Int?, val ticket: String)

/** What only happens after the device lock and password. */
enum class VoucherStep { PIN_ZEIGEN, NUMBER_COPY, PIN_COPY, PDF, EXPORT, DELETE }

/**
 * The password (and code) prompt, before [schritt] runs for voucher [id];
 * [id] is null for exporting all of them.
 */
data class VoucherConfirmation(
    val schritt: VoucherStep,
    val id: Int?,
    /** The server has asked for the second-factor code. */
    val codeNoetig: Boolean = false,
    val operation: Vorgang = Vorgang.Fertig,
)

data class CopyJob(val wert: String, val isNumber: Boolean)
