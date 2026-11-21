package ch.brickinventoryapp.services.alarm

import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.AlarmabrufView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.data.repository.Ergebnis as Abrufergebnis
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * The query itself — a type alias, so the signature of [Alarmabholung.fetch]
 * stays readable. Top-level, because Kotlin only allows type aliases there.
 */
typealias Frage = suspend (String?) -> Abrufergebnis<AlarmabrufView>

/**
 * What is decided when fetching triggered price alerts — outside of the
 * worker, because a ListenableWorker can only be tested with Android running.
 * The worker obtains the context, calls in here, and displays whatever comes back.
 */
internal object Alarmabholung {

    /** What one run produced. */
    sealed interface Ergebnis {
        /**
         * Fetched. `meldungen` may be empty — that's the normal case. `neueMarke` always
         * has to be stored, even without a notification: otherwise the next run would query from the
         * old timestamp and bring in the same notification a second time.
         */
        data class Geholt(val meldungen: List<PriceAlertView>, val neueMarke: String) : Ergebnis

        /**
         * First run — there was no marker yet. Deliberately without a notification: a freshly
         * set-up app shouldn't open with thresholds that were crossed weeks
         * ago. The server returns an empty list without `since` anyway; the
         * distinction is written here on purpose, so it is visible in the code and not just a
         * side effect of a server response.
         */
        data class Markiert(val neueMarke: String) : Ergebnis

        /** Unreachable or rejected — the marker stays as it was. */
        data object Fehlgeschlagen : Ergebnis
    }

    /**
     * Run one pass. The query is a parameter so a unit test can supply it
     * without Retrofit and the disk cache — otherwise exactly what is decided here would only be observable in production. As with
     * the server's mail dispatch (utils/preisalarm.ts): whoever decides gets the how
     * handed in.
     *
     * @param marke the time of the last successful run, empty on the
     *         very first one
     */
    suspend fun fetch(marke: String?, frage: Frage): Ergebnis {
        val r = frage(marke?.takeIf { it.isNotBlank() })
        val antwort = (r as? Abrufergebnis.Erfolg)?.data ?: return Ergebnis.Fehlgeschlagen
        // Without `now` there is no new marker — and without a new marker, better store
        // nothing at all than a wrong one. A server that doesn't know the field
        // is an older version; then it stays with mail dispatch.
        val neueMarke = antwort.marke?.takeIf { it.isNotBlank() } ?: return Ergebnis.Fehlgeschlagen
        if (marke.isNullOrBlank()) return Ergebnis.Markiert(neueMarke)
        return Ergebnis.Geholt(antwort.alerts, neueMarke)
    }

    /**
     * The text of a notification — here, not in the worker, so it can be tested without
     * Android. Two decimal places and the alert's own currency, not the
     * current account currency: the threshold was set in that currency, and 200 CHF
     * is not 200 EUR. The amount in the form of [zahlen] („199,50 CHF“), as everywhere
     * in the app and in the web UI.
     */
    fun text(a: PriceAlertView, unter: String, ueber: String, zahlen: Locale): String {
        val richtung = if (a.richtung == Alarmrichtung.UNTER) unter else ueber
        val format = NumberFormat.getCurrencyInstance(zahlen).apply {
            runCatching { currency = Currency.getInstance(a.currencyCode.code) }
            minimumFractionDigits = 2
            maximumFractionDigits = 2
        }
        val preis = a.lastlyPrice
        val schwelle = format.format(a.schwelle.asBigDecimal())
        return if (preis == null)
            "${a.setNumber}: $richtung $schwelle"
        else
            "${a.setNumber}: ${format.format(preis.asBigDecimal())} ($richtung $schwelle)"
    }
}
