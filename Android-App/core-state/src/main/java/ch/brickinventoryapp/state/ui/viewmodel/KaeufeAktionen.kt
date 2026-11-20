package ch.brickinventoryapp.state.ui.viewmodel

import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.KEINE_FARBE

/**
 * Was die Kauf- und Detailbildschirme an den Käufen eines Eintrags ändern.
 * Die Bildschirme kennen nur diese Schnittstelle; ein Test oder eine Vorschau
 * reicht eine Attrappe statt des ViewModels.
 */
interface KaeufeAktionen {
    fun loadAcquisitions(setNumber: String)
    fun loadManualAcquisitions(type: Postenart, id: String, colorId: Int = KEINE_FARBE)
    fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null, condition: Zustand? = null,
                          quantity: Int? = null, date: String? = null)
    fun deleteAcquisition(setNumber: String, acqId: Int)
    fun updateManualAcquisition(
        type: Postenart, id: String, colorId: Int, acqId: Int,
        unitPrice: Double? = null, condition: Zustand? = null, quantity: Int? = null, date: String? = null,
    )
    fun deleteManualAcquisition(type: Postenart, id: String, colorId: Int, acqId: Int)
    /** Löschen mit „Rückgängig“; ohne Snackbar, die es anbietet, gleich löschen. */
    fun purchaseDeleteReserve(type: Postenart, id: String, colorId: Int, acqId: Int) =
        if (type == Postenart.SET) deleteAcquisition(id, acqId) else deleteManualAcquisition(type, id, colorId, acqId)
    fun changeAcquisitionOwner(
        type: Postenart, id: String, colorId: Int, acqId: Int,
        toUserId: Int, onDone: (String?, Int, Int) -> Unit = { _, _, _ -> },
    )
    fun setManualLocation(type: Postenart, id: String, farbe: Int, ort: String)
}
