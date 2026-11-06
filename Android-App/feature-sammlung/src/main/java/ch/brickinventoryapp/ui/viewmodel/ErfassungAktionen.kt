package ch.brickinventoryapp.ui.viewmodel

/**
 * Was die Erfassungsdialoge auslösen. Sie stehen über jedem Bildschirm; als
 * Schnittstelle lassen sie sich mit festem Zustand zeigen und prüfen.
 */
interface ErfassungAktionen {
    fun confirmAddBarcode(setNum: String, purchasePrice: Double? = null, condition: String? = null,
                          ownerUserId: Int? = null, storage: String? = null, quantity: Int = 1)
    fun cancelBarcode()
    fun brichPruefungAb()
}
