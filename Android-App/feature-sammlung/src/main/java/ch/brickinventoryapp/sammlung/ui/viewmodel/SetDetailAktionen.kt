package ch.brickinventoryapp.sammlung.ui.viewmodel

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef

/**
 * Was das Set-Detail auslöst. Der Bildschirm kennt nur diese Schnittstelle;
 * so lässt er sich mit einem festen Zustand zeigen, ohne Hilt und Server.
 */
interface SetDetailAktionen {
    fun loadSetDetail(setNumber: String)
    fun loadSetPrice(setNumber: String)
    fun loadSetPriceHistory(setNumber: String)
    fun loadAcquisitions(setNumber: String)
    fun loadPreisalarme(setNumber: String)
    fun setzePreisalarm(setNumber: String, richtung: String, roh: String, zustand: Zustand)
    fun aendereMengeUm(setNumber: String, schritt: Int)
    fun setzeSetLagerort(setNumber: String, ort: String)
    fun loadLagerortVorrat(besitzer: List<Int>)
    fun ladeAnleitungHoch(setNumber: String, datei: DateiRef)
    fun loescheAnleitung(setNumber: String, instrId: Int)
}
