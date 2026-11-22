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
class AppLock(private val clock: () -> Long, private val store: Store, private val devicesStart: () -> Int? = { null }) {

    /** Per device; [minutes] 0 means off. [locked] lives here, so rotating or ending the process doesn't unlock. */
    interface Store {
        fun minutes(): Int
        fun setMinutes(minutes: Int)
        fun backgroundSince(): Long?
        fun rememberBackground(since: Long?)
        fun backgroundStart(): Int?
        fun rememberBackgroundStart(start: Int?)
        fun locked(): Boolean
        fun setLocked(an: Boolean)
    }

    private val _minutes = MutableStateFlow(store.minutes())
    val minutes: StateFlow<Int> = _minutes.asStateFlow()

    private val _locked = MutableStateFlow(store.locked())
    val locked: StateFlow<Boolean> = _locked.asStateFlow()

    fun setMinutes(minutes: Int) {
        store.setMinutes(minutes)
        _minutes.value = minutes
    }

    /** onStop: an already locked app doesn't keep its earlier timestamp, it stays locked. */
    fun inBackground() {
        if (_locked.value) return
        store.rememberBackgroundStart(devicesStart())
        store.rememberBackground(clock())
    }

    /** onStart (also after a restart of the process). */
    fun inForeground() {
        val since = store.backgroundSince() ?: return
        val start = store.backgroundStart()
        store.rememberBackground(null)
        store.rememberBackgroundStart(null)
        val deadline = _minutes.value * MINUTE_MS
        val now = clock()
        // After a device restart the clock starts at zero: whether the deadline expired is open.
        // An unreadable counter counts as a different start; without a remembered one (older store), only the clock counts.
        val restarted = start != null && devicesStart() != start
        if (deadline > 0 && (restarted || now < since || now - since >= deadline)) set(true)
    }

    fun unlocked() = set(false)

    private fun set(an: Boolean) {
        store.setLocked(an)
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
        fun default(newInstalled: Boolean, deviceSecured: Boolean): Int =
            if (newInstalled && deviceSecured) DEFAULT_MINUTES else 0

        /**
         * Whether the widget hides monetary values: locked, or already in the
         * background with the lock turned on. The widget isn't redrawn when the deadline expires; if it
         * waited for that, the amounts would sit exposed on the home screen until the next run.
         */
        fun hiddenWidget(store: Store): Boolean =
            store.locked() || store.minutes() > 0 && store.backgroundSince() != null
    }
}
