package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.file.FileRef

/**
 * Was das Set-Detail auslöst. Der Bildschirm kennt nur diese Schnittstelle;
 * so lässt er sich mit einem festen Zustand zeigen, ohne Hilt und Server.
 */
interface SetDetailAktionen {
    /** Alles neu holen; geladen wird beim Erzeugen, nicht vom Bildschirm. */
    fun refresh()
    fun setPriceAlert(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand)
    fun changeQuantityUm(setNumber: String, schritt: Int)
    fun setSetLocation(setNumber: String, ort: String)
    fun loadLocationStock(besitzer: List<Int>)
    fun loadInstructionHigh(setNumber: String, datei: FileRef)
    fun loescheAnleitung(setNumber: String, instrId: Int)
}
