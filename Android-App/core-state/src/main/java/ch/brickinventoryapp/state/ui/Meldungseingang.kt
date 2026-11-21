package ch.brickinventoryapp.state.ui

import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Singleton

/** Set numbers like „75192-1“ or „col23-1“; anything else is not a target. */
private val SETNUMMER = Regex("^[0-9A-Za-z-]{1,20}$")

/** The set number, if it fits the format, otherwise null. */
fun setNumberFromMessage(roh: String?): String? = roh?.takeIf { SETNUMMER.matches(it) }

/**
 * The target of a tapped notification, stored in-process. The exported
 * MainActivity no longer reads any extras: only the non-exported
 * MeldungsEinstieg stores it here, and no foreign app can start that.
 */
@Singleton
class Meldungseingang @Inject constructor() {
    private val ziel = AtomicReference<String?>(null)

    /** @return false if [roh] is not a set number; then nothing is left stored. */
    fun ablegen(roh: String?): Boolean {
        val sn = setNumberFromMessage(roh) ?: return false
        ziel.set(sn)
        return true
    }

    /** Fetch once: a second start of the same activity doesn't open the set again. */
    fun abholen(): String? = ziel.getAndSet(null)
}
