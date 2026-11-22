package ch.brickinventoryapp.state.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * User CAs for the app's own server: turning on only via [requests] and
 * [confirm], because an installed CA (company, malware) can
 * read along with the traffic. Turning off lowers the risk and needs no question.
 */
class UserCaToggle(
    read: () -> Boolean,
    private val write: (Boolean) -> Unit,
    /** Open connections carried the old trust. */
    private val afterChange: () -> Unit,
) {
    private val _an = MutableStateFlow(read())
    val an: StateFlow<Boolean> = _an.asStateFlow()

    /** Is the question waiting for yes or no? The dialog reads this. */
    private val _question = MutableStateFlow(false)
    val question: StateFlow<Boolean> = _question.asStateFlow()

    fun requests() {
        if (!_an.value) _question.value = true
    }

    fun confirm() {
        if (!_question.value) return
        _question.value = false
        set(true)
    }

    fun cancel() {
        _question.value = false
    }

    fun turnOff() {
        _question.value = false
        if (_an.value) set(false)
    }

    private fun set(value: Boolean) {
        write(value)
        _an.value = value
        afterChange()
    }
}
