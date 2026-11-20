package ch.brickinventoryapp.account.ui.viewmodel

import ch.brickinventoryapp.account.ui.UpdateUiState
import kotlinx.coroutines.flow.StateFlow

/** Was Update-Hinweis und Update-Karte auslösen. */
interface UpdateAktionen {
    fun pruefeAufUpdate(still: Boolean = false)
    /** Die stille Prüfung beim Start, nur wenn der Schalter des Geräts an ist. */
    fun pruefeBeimStart()
    fun setStartpruefung(an: Boolean)
    fun closeUpdateHint()
    fun ladeUpdate()
    fun cancelLoad()
    fun startInstallation()

    /** Aktionen samt Zustand, wie der Hinweis sie liest; so zeigt ihn ein Test ohne Download. */
    interface WithState : UpdateAktionen {
        val zustand: StateFlow<UpdateUiState>
    }
}
