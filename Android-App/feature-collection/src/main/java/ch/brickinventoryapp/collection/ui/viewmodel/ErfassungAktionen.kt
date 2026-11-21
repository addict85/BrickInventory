package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.model.domain.Erfassungswunsch

/**
 * What the capture dialogs trigger. They sit above every screen; as an
 * interface they can be shown and tested with a fixed state.
 */
interface ErfassungAktionen {
    fun confirmAddBarcode(wish: Erfassungswunsch)
    fun cancelBarcode()
    fun abortCheckAb()
}
