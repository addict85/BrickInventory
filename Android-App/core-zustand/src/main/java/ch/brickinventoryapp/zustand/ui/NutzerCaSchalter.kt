package ch.brickinventoryapp.zustand.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Nutzer-CAs für den eigenen Server: Einschalten nur über [anfragen] und
 * [bestaetigen], weil eine installierte CA (Firma, Schadsoftware) den Verkehr
 * mitlesen kann. Ausschalten senkt das Risiko und geht ohne Frage.
 */
class NutzerCaSchalter(
    lies: () -> Boolean,
    private val schreibe: (Boolean) -> Unit,
    /** Offene Verbindungen trugen das alte Vertrauen. */
    private val nachAenderung: () -> Unit,
) {
    private val _an = MutableStateFlow(lies())
    val an: StateFlow<Boolean> = _an.asStateFlow()

    /** Wartet die Frage auf Ja oder Nein? Der Dialog liest hier. */
    private val _frage = MutableStateFlow(false)
    val frage: StateFlow<Boolean> = _frage.asStateFlow()

    fun anfragen() {
        if (!_an.value) _frage.value = true
    }

    fun bestaetigen() {
        if (!_frage.value) return
        _frage.value = false
        setze(true)
    }

    fun abbrechen() {
        _frage.value = false
    }

    fun ausschalten() {
        _frage.value = false
        if (_an.value) setze(false)
    }

    private fun setze(wert: Boolean) {
        schreibe(wert)
        _an.value = wert
        nachAenderung()
    }
}
