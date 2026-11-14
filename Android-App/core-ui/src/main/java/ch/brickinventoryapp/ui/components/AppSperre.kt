package ch.brickinventoryapp.ui.components

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Sperrt die App, wenn sie länger als die gewählten Minuten im Hintergrund lag.
 * [uhr] läuft monoton (elapsedRealtime): Eine verstellte Uhr verlängert nichts, und
 * weil sie den Prozess überlebt, zählt auch eine Rückkehr nach dessen Ende richtig.
 * Nach einem Neustart des Geräts beginnt sie aber neu; [geraeteStart] (BOOT_COUNT)
 * erkennt das sicher, auch wenn die neue Uhr schon über dem alten Zeitpunkt steht.
 */
class AppSperre(private val uhr: () -> Long, private val ablage: Ablage, private val geraeteStart: () -> Int? = { null }) {

    /** Je Gerät; [minuten] 0 heisst aus. [gesperrt] liegt hier, damit Drehen oder Prozessende nicht entsperren. */
    interface Ablage {
        fun minuten(): Int
        fun setzeMinuten(minuten: Int)
        fun hintergrundSeit(): Long?
        fun merkeHintergrund(seit: Long?)
        fun hintergrundStart(): Int?
        fun merkeHintergrundStart(start: Int?)
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
        if (_gesperrt.value) return
        ablage.merkeHintergrundStart(geraeteStart())
        ablage.merkeHintergrund(uhr())
    }

    /** onStart (auch nach einem Neustart des Prozesses). */
    fun imVordergrund() {
        val seit = ablage.hintergrundSeit() ?: return
        val start = ablage.hintergrundStart()
        ablage.merkeHintergrund(null)
        ablage.merkeHintergrundStart(null)
        val frist = _minuten.value * MINUTE_MS
        val jetzt = uhr()
        // Nach einem Neustart des Geräts beginnt die Uhr bei null: Ob die Frist ablief, ist offen.
        // Ein unlesbarer Zähler gilt als anderer Start; ohne gemerkten (ältere Ablage) zählt nur die Uhr.
        val neugestartet = start != null && geraeteStart() != start
        if (frist > 0 && (neugestartet || jetzt < seit || jetzt - seit >= frist)) setze(true)
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

        /**
         * Ob das Widget Geldwerte verdeckt: gesperrt, oder bei eingeschalteter Sperre schon im
         * Hintergrund. Das Widget wird beim Ablauf der Frist nicht neu gezeichnet; wartete es
         * darauf, stünden die Beträge bis zum nächsten Lauf offen auf dem Startbildschirm.
         */
        fun verdecktWidget(ablage: Ablage): Boolean =
            ablage.gesperrt() || ablage.minuten() > 0 && ablage.hintergrundSeit() != null
    }
}
