package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.model.domain.Erfassungswunsch

/**
 * Was die Erfassungsdialoge auslösen. Sie stehen über jedem Bildschirm; als
 * Schnittstelle lassen sie sich mit festem Zustand zeigen und prüfen.
 */
interface ErfassungAktionen {
    fun confirmAddBarcode(wish: Erfassungswunsch)
    fun cancelBarcode()
    fun abortCheckAb()
}
