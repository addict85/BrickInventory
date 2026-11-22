package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.file.FileRef

/**
 * What the set detail triggers. The screen knows only this interface;
 * that way it can be shown with a fixed state, without Hilt and server.
 */
internal interface SetDetailActions {
    /** Fetch everything anew; loading happens on creation, not from the screen. */
    fun refresh()
    fun setPriceAlert(setNumber: String, direction: AlarmDirection, raw: String, condition: Condition)
    fun changeQuantityBy(setNumber: String, step: Int)
    fun setSetLocation(setNumber: String, location: String)
    fun loadLocationStock(owner: List<Int>)
    fun loadInstructionHigh(setNumber: String, file: FileRef)
    fun deleteInstruction(setNumber: String, instrId: Int)
}
