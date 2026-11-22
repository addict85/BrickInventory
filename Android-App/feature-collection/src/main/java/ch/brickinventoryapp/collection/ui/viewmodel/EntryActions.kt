package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.model.domain.EntryRequest

/**
 * What the capture dialogs trigger. They sit above every screen; as an
 * interface they can be shown and tested with a fixed state.
 */
interface EntryActions {
    fun confirmAddBarcode(wish: EntryRequest)
    fun cancelBarcode()
    fun cancelCheck()
}
