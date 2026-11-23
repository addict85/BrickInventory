package ch.brickinventoryapp.state.ui.viewmodel

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.NO_COLOR

/**
 * What the purchase and detail screens change about an entry's purchases.
 * The screens know only this interface; a test or a preview
 * supplies a fake instead of the ViewModel.
 */
interface PurchasesActions {
    fun loadAcquisitions(setNumber: String)
    fun loadManualAcquisitions(type: ItemKind, id: String, colorId: Int = NO_COLOR)
    fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null, condition: Condition? = null,
                          quantity: Int? = null, date: String? = null)
    fun deleteAcquisition(setNumber: String, acqId: Int)
    fun updateManualAcquisition(
        type: ItemKind, id: String, colorId: Int, acqId: Int,
        unitPrice: Double? = null, condition: Condition? = null, quantity: Int? = null, date: String? = null,
    )
    fun deleteManualAcquisition(type: ItemKind, id: String, colorId: Int, acqId: Int)
    /** Delete with „undo“; without a snackbar offering it, delete right away. */
    fun purchaseDeleteReserve(type: ItemKind, id: String, colorId: Int, acqId: Int) =
        if (type == ItemKind.SET) deleteAcquisition(id, acqId) else deleteManualAcquisition(type, id, colorId, acqId)
    fun changeAcquisitionOwner(
        type: ItemKind, id: String, colorId: Int, acqId: Int,
        toUserId: Int, onDone: (String?, Int, Int) -> Unit = { _, _, _ -> },
    )
    fun setManualLocation(type: ItemKind, id: String, color: Int, location: String)
}
