package ch.brickinventoryapp.ui.components

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Sperrt die App, wenn sie länger als die gewählten Minuten im Hintergrund lag.
 * [clock] läuft monoton (elapsedRealtime): Eine verstellte Uhr verlängert nichts, und
 * weil sie den Prozess überlebt, zählt auch eine Rückkehr nach dessen Ende richtig.
 * Nach einem Neustart des Geräts beginnt sie aber neu; [devicesStart] (BOOT_COUNT)
 * erkennt das sicher, auch wenn die neue Uhr schon über dem alten Zeitpunkt steht.
 */
class AppLock(private val clock: () -> Long, private val ablage: Ablage, private val devicesStart: () -> Int? = { null }) {

    /** Je Gerät; [minuten] 0 heisst aus. [gesperrt] liegt hier, damit Drehen oder Prozessende nicht entsperren. */
    interface Ablage {
        fun minuten(): Int
        fun setMinutes(minuten: Int)
        fun backgroundSince(): Long?
        fun rememberBackground(seit: Long?)
        fun backgroundStart(): Int?
        fun rememberBackgroundStart(start: Int?)
        fun gesperrt(): Boolean
        fun setLocked(an: Boolean)
    }

    private val _minutes = MutableStateFlow(ablage.minuten())
    val minuten: StateFlow<Int> = _minutes.asStateFlow()

    private val _locked = MutableStateFlow(ablage.gesperrt())
    val gesperrt: StateFlow<Boolean> = _locked.asStateFlow()

    fun setMinutes(minuten: Int) {
        ablage.setMinutes(minuten)
        _minutes.value = minuten
    }

    /** onStop: Eine schon gesperrte App behält ihren früheren Zeitpunkt nicht, sie bleibt gesperrt. */
    fun inBackground() {
        if (_locked.value) return
        ablage.rememberBackgroundStart(devicesStart())
        ablage.rememberBackground(clock())
    }

    /** onStart (auch nach einem Neustart des Prozesses). */
    fun inForeground() {
        val seit = ablage.backgroundSince() ?: return
        val start = ablage.backgroundStart()
        ablage.rememberBackground(null)
        ablage.rememberBackgroundStart(null)
        val deadline = _minutes.value * MINUTE_MS
        val jetzt = clock()
        // Nach einem Neustart des Geräts beginnt die Uhr bei null: Ob die Frist ablief, ist offen.
        // Ein unlesbarer Zähler gilt als anderer Start; ohne gemerkten (ältere Ablage) zählt nur die Uhr.
        val restarted = start != null && devicesStart() != start
        if (deadline > 0 && (restarted || jetzt < seit || jetzt - seit >= deadline)) setze(true)
    }

    fun entsperrt() = setze(false)

    private fun setze(an: Boolean) {
        ablage.setLocked(an)
        _locked.value = an
    }

    companion object {
        const val MINUTE_MS = 60_000L
        /** Die Wahl in den Einstellungen; 0 ist aus. */
        val CHOICE = listOf(0, 1, 5, 15, 30)

        /** Die Vorgabe einer neuen Installation mit Displaysperre. */
        const val DEFAULT_MINUTES = 5

        /**
         * Neu installiert und mit Displaysperre: an. Ein Update ändert nichts, was der Nutzer
         * bisher hatte; ohne Displaysperre gäbe es nichts, womit sich entsperren liesse.
         */
        fun vorgabe(newInstalled: Boolean, deviceSecured: Boolean): Int =
            if (newInstalled && deviceSecured) DEFAULT_MINUTES else 0

        /**
         * Ob das Widget Geldwerte verdeckt: gesperrt, oder bei eingeschalteter Sperre schon im
         * Hintergrund. Das Widget wird beim Ablauf der Frist nicht neu gezeichnet; wartete es
         * darauf, stünden die Beträge bis zum nächsten Lauf offen auf dem Startbildschirm.
         */
        fun hiddenWidget(ablage: Ablage): Boolean =
            ablage.gesperrt() || ablage.minuten() > 0 && ablage.backgroundSince() != null
    }
}
