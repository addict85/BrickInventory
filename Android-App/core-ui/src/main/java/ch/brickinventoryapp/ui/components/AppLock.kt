package ch.brickinventoryapp.ui.components

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Locks the app if it has sat in the background longer than the chosen minutes.
 * [clock] runs monotonically (elapsedRealtime): a changed clock extends nothing, and
 * because it survives the process, a return even after the process ended is counted correctly.
 * After a device restart, though, it starts over; [devicesStart] (BOOT_COUNT)
 * detects this reliably, even when the new clock already stands past the old timestamp.
 */
class AppLock(private val clock: () -> Long, private val ablage: Ablage, private val devicesStart: () -> Int? = { null }) {

    /** Per device; [minuten] 0 means off. [gesperrt] lives here, so rotating or ending the process doesn't unlock. */
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

    /** onStop: an already locked app doesn't keep its earlier timestamp, it stays locked. */
    fun inBackground() {
        if (_locked.value) return
        ablage.rememberBackgroundStart(devicesStart())
        ablage.rememberBackground(clock())
    }

    /** onStart (also after a restart of the process). */
    fun inForeground() {
        val seit = ablage.backgroundSince() ?: return
        val start = ablage.backgroundStart()
        ablage.rememberBackground(null)
        ablage.rememberBackgroundStart(null)
        val deadline = _minutes.value * MINUTE_MS
        val jetzt = clock()
        // After a device restart the clock starts at zero: whether the deadline expired is open.
        // An unreadable counter counts as a different start; without a remembered one (older store), only the clock counts.
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
        /** The choice in settings; 0 is off. */
        val CHOICE = listOf(0, 1, 5, 15, 30)

        /** The default for a fresh install with a screen lock. */
        const val DEFAULT_MINUTES = 5

        /**
         * Freshly installed and with a screen lock: on. An update changes nothing the user
         * had before; without a screen lock there would be nothing to unlock with.
         */
        fun vorgabe(newInstalled: Boolean, deviceSecured: Boolean): Int =
            if (newInstalled && deviceSecured) DEFAULT_MINUTES else 0

        /**
         * Whether the widget hides monetary values: locked, or already in the
         * background with the lock turned on. The widget isn't redrawn when the deadline expires; if it
         * waited for that, the amounts would sit exposed on the home screen until the next run.
         */
        fun hiddenWidget(ablage: Ablage): Boolean =
            ablage.gesperrt() || ablage.minuten() > 0 && ablage.backgroundSince() != null
    }
}
