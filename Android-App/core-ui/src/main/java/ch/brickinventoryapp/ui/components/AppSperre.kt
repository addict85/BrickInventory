package ch.brickinventoryapp.ui.components

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Sperrt die App, wenn sie länger als die gewählten Minuten im Hintergrund lag.
 * [uhr] läuft monoton (elapsedRealtime): Eine verstellte Uhr verlängert nichts, und
 * weil sie den Prozess überlebt, zählt auch eine Rückkehr nach dessen Ende richtig.
 */
class AppSperre(private val uhr: () -> Long, private val ablage: Ablage) {

    /** Je Gerät; [minuten] 0 heisst aus. [gesperrt] liegt hier, damit Drehen oder Prozessende nicht entsperren. */
    interface Ablage {
        fun minuten(): Int
        fun setzeMinuten(minuten: Int)
        fun hintergrundSeit(): Long?
        fun merkeHintergrund(seit: Long?)
        fun gesperrt(): Boolean
        fun setzeGesperrt(an: Boolean)
    }

    private val _minuten = MutableStateFlow(ablage.minuten())
    val minuten: StateFlow<Int> = _minuten.asStateFlow()

    private val _gesperrt = MutableStateFlow(ablage.gesperrt())
    val gesperrt: StateFlow<Boolean> = _gesperrt.asStateFlow()

    fun setzeMinuten(minuten: Int) {
        ablage.setzeMinuten(minuten)
        _minuten.value = minuten
    }

    /** onStop: Eine schon gesperrte App behält ihren früheren Zeitpunkt nicht, sie bleibt gesperrt. */
    fun imHintergrund() {
        if (!_gesperrt.value) ablage.merkeHintergrund(uhr())
    }

    /** onStart (auch nach einem Neustart des Prozesses). */
    fun imVordergrund() {
        val seit = ablage.hintergrundSeit() ?: return
        ablage.merkeHintergrund(null)
        val frist = _minuten.value * MINUTE_MS
        val jetzt = uhr()
        // Nach einem Neustart des Geräts beginnt die Uhr bei null: Ob die Frist ablief, ist offen.
        if (frist > 0 && (jetzt < seit || jetzt - seit >= frist)) setze(true)
    }

    fun entsperrt() = setze(false)

    private fun setze(an: Boolean) {
        ablage.setzeGesperrt(an)
        _gesperrt.value = an
    }

    companion object {
        const val MINUTE_MS = 60_000L
        /** Die Wahl in den Einstellungen; 0 ist aus. */
        val WAHL = listOf(0, 1, 5, 15, 30)
    }
}
