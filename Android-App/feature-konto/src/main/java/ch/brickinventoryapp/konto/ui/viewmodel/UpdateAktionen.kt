package ch.brickinventoryapp.konto.ui.viewmodel

import ch.brickinventoryapp.konto.ui.UpdateUiState
import kotlinx.coroutines.flow.StateFlow

/** Was Update-Hinweis und Update-Karte auslösen. */
interface UpdateAktionen {
    fun pruefeAufUpdate(still: Boolean = false)
    /** Die stille Prüfung beim Start, nur wenn der Schalter des Geräts an ist. */
    fun pruefeBeimStart()
    fun setzeStartpruefung(an: Boolean)
    fun updateHinweisSchliessen()
    fun ladeUpdate()
    fun ladeAbbrechen()
    fun starteInstallation()

    /** Aktionen samt Zustand, wie der Hinweis sie liest; so zeigt ihn ein Test ohne Download. */
    interface MitZustand : UpdateAktionen {
        val zustand: StateFlow<UpdateUiState>
    }
}
