package ch.brickinventoryapp.state.ui

import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Singleton

/** Set numbers like „75192-1“ or „col23-1“; anything else is not a target. */
private val SET_NUMBER = Regex("^[0-9A-Za-z-]{1,20}$")

/** The set number, if it fits the format, otherwise null. */
fun setNumberFromMessage(raw: String?): String? = raw?.takeIf { SET_NUMBER.matches(it) }

/**
 * The target of a tapped notification, stored in-process. The exported
 * MainActivity no longer reads any extras: only the non-exported
 * MessageEntryPoint stores it here, and no foreign app can start that.
 */
@Singleton
class MessageInbox @Inject constructor() {
    private val target = AtomicReference<String?>(null)

    /** @return false if [raw] is not a set number; then nothing is left stored. */
    fun put(raw: String?): Boolean {
        val sn = setNumberFromMessage(raw) ?: return false
        target.set(sn)
        return true
    }

    /** Fetch once: a second start of the same activity doesn't open the set again. */
    fun pickUp(): String? = target.getAndSet(null)
}
