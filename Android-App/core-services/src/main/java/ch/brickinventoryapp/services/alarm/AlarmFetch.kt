package ch.brickinventoryapp.services.alarm

import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.AlarmFetchView
import ch.brickinventoryapp.model.domain.PriceAlertView
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import ch.brickinventoryapp.model.outcome.Outcome as FetchOutcome

/**
 * The query itself — a type alias, so the signature of [AlarmFetch.fetch]
 * stays readable. Top-level, because Kotlin only allows type aliases there.
 */
typealias Question = suspend (String?) -> FetchOutcome<AlarmFetchView>

/**
 * What is decided when fetching triggered price alerts — outside of the
 * worker, because a ListenableWorker can only be tested with Android running.
 * The worker obtains the context, calls in here, and displays whatever comes back.
 */
internal object AlarmFetch {

    /** What one run produced. */
    sealed interface Outcome {
        /**
         * Fetched. `messages` may be empty — that's the normal case. `newBrand` always
         * has to be stored, even without a notification: otherwise the next run would query from the
         * old timestamp and bring in the same notification a second time.
         */
        data class Fetched(val messages: List<PriceAlertView>, val newBrand: String) : Outcome

        /**
         * First run — there was no marker yet. Deliberately without a notification: a freshly
         * set-up app shouldn't open with thresholds that were crossed weeks
         * ago. The server returns an empty list without `since` anyway; the
         * distinction is written here on purpose, so it is visible in the code and not just a
         * side effect of a server response.
         */
        data class Marked(val newBrand: String) : Outcome

        /** Unreachable or rejected — the marker stays as it was. */
        data object Failed : Outcome
    }

    /**
     * Run one pass. The query is a parameter so a unit test can supply it
     * without Retrofit and the disk cache — otherwise exactly what is decided here would only be observable in production. As with
     * the server's mail dispatch (`utils/preisalarm.ts`): whoever decides gets the how
     * handed in.
     *
     * @param brand the time of the last successful run, empty on the
     *         very first one
     */
    suspend fun fetch(brand: String?, question: Question): Outcome {
        val r = question(brand?.takeIf { it.isNotBlank() })
        // A failed fetch is the worker's retry, not a silent success.
        val response = when (r) {
            is FetchOutcome.Success -> r.data
            is FetchOutcome.Failure -> return Outcome.Failed
        }
        // Without `now` there is no new marker — and without a new marker, better store
        // nothing at all than a wrong one. A server that doesn't know the field
        // is an older version; then it stays with mail dispatch.
        val newBrand = response.brand?.takeIf { it.isNotBlank() } ?: return Outcome.Failed
        if (brand.isNullOrBlank()) return Outcome.Marked(newBrand)
        return Outcome.Fetched(response.alerts, newBrand)
    }

    /**
     * The text of a notification — here, not in the worker, so it can be tested without
     * Android. Two decimal places and the alert's own currency, not the
     * current account currency: the threshold was set in that currency, and 200 CHF
     * is not 200 EUR. The amount in the form of [numbers] („199,50 CHF“), as everywhere
     * in the app and in the web UI.
     */
    fun text(a: PriceAlertView, below: String, over: String, numbers: Locale): String {
        val direction = if (a.direction == AlarmDirection.BELOW) below else over
        val format = NumberFormat.getCurrencyInstance(numbers).apply {
            runCatching { currency = Currency.getInstance(a.currencyCode.code) }
            minimumFractionDigits = 2
            maximumFractionDigits = 2
        }
        val price = a.lastlyPrice
        val threshold = format.format(a.threshold.asBigDecimal())
        return if (price == null)
            "${a.setNumber}: $direction $threshold"
        else
            "${a.setNumber}: ${format.format(price.asBigDecimal())} ($direction $threshold)"
    }
}
