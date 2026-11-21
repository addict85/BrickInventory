package ch.brickinventoryapp.data.alarm

import ch.brickinventoryapp.model.domain.Geld

/**
 * What becomes of what someone types into the threshold field. Saved while typing,
 * debounced, like the purchase price — not only on focus loss: on the phone one types the number,
 * closes the keyboard and goes back, and that focus change never comes.
 */
object Alarmeingabe {

    /**
     * How long it must be quiet before saving. The same number as in the
     * web app (ALARM_RUHE in public/js/admin.js), so that the same field behaves the same
     * in both places. 800 ms instead of 350 as for the search: an alert creates something,
     * and whoever briefly ponders between „24“ and „249.90“ should not get a threshold at 24
     * that reports immediately.
     */
    const val RUHE_MS = 800L

    /**
     * The typed string as an amount — or `null` if the alert should go away. Emptying the
     * field is the natural gesture to get rid of an alert; a separate
     * button would be a second path for the same intent.
     */
    fun zahl(roh: String): Geld? {
        val z = Geld.fromText(roh.replace(',', '.')) ?: return null
        // Non-positive thresholds are no alert but one that never
        // or always reports. The server rejects them as well
        // (pruefeEingabe in utils/preisalarm.ts) — here it catches the request
        // even before.
        return z.takeIf { it.positive }
    }
}
