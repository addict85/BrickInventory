package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.file.FileRef

/**
 * What the set detail triggers. The screen knows only this interface;
 * that way it can be shown with a fixed state, without Hilt and server.
 */
interface SetDetailAktionen {
    /** Fetch everything anew; loading happens on creation, not from the screen. */
    fun refresh()
    fun setPriceAlert(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand)
    fun changeQuantityUm(setNumber: String, schritt: Int)
    fun setSetLocation(setNumber: String, ort: String)
    fun loadLocationStock(besitzer: List<Int>)
    fun loadInstructionHigh(setNumber: String, datei: FileRef)
    fun loescheAnleitung(setNumber: String, instrId: Int)
}
