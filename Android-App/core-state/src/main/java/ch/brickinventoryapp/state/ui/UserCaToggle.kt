package ch.brickinventoryapp.state.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * User CAs for the app's own server: turning on only via [requests] and
 * [bestaetigen], because an installed CA (company, malware) can
 * read along with the traffic. Turning off lowers the risk and needs no question.
 */
class UserCaToggle(
    lies: () -> Boolean,
    private val schreibe: (Boolean) -> Unit,
    /** Open connections carried the old trust. */
    private val afterChange: () -> Unit,
) {
    private val _an = MutableStateFlow(lies())
    val an: StateFlow<Boolean> = _an.asStateFlow()

    /** Is the question waiting for yes or no? The dialog reads this. */
    private val _question = MutableStateFlow(false)
    val frage: StateFlow<Boolean> = _question.asStateFlow()

    fun requests() {
        if (!_an.value) _question.value = true
    }

    fun bestaetigen() {
        if (!_question.value) return
        _question.value = false
        setze(true)
    }

    fun abbrechen() {
        _question.value = false
    }

    fun turnOff() {
        _question.value = false
        if (_an.value) setze(false)
    }

    private fun setze(wert: Boolean) {
        schreibe(wert)
        _an.value = wert
        afterChange()
    }
}
