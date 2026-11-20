package ch.brickinventoryapp.zustand.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Nutzer-CAs für den eigenen Server: Einschalten nur über [requests] und
 * [bestaetigen], weil eine installierte CA (Firma, Schadsoftware) den Verkehr
 * mitlesen kann. Ausschalten senkt das Risiko und geht ohne Frage.
 */
class UserCaToggle(
    lies: () -> Boolean,
    private val schreibe: (Boolean) -> Unit,
    /** Offene Verbindungen trugen das alte Vertrauen. */
    private val afterChange: () -> Unit,
) {
    private val _an = MutableStateFlow(lies())
    val an: StateFlow<Boolean> = _an.asStateFlow()

    /** Wartet die Frage auf Ja oder Nein? Der Dialog liest hier. */
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
