package ch.brickinventoryapp.sammlung.ui.viewmodel

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.data.ScopeFilter

/** Was Merkliste und Merkposten-Detail auslösen; die Bildschirme kennen nur diese Schnittstelle. */
internal interface MerklisteAktionen {
    fun ladeMerkliste()
    fun setScope(view: ScopeFilter.View, value: String)
    fun setzeMerklisteSuche(q: String)
    /** null: beide Zustände. */
    fun setzeMerklisteZustand(zustand: Zustand?)
    fun setzeMerklisteSortierung(sortierung: Merksortierung)
    fun legeMerkpostenAn(setNumber: String, zustand: Zustand, besitzer: Int? = null)
    fun verschiebeMerkposten(setNumber: String, zustand: Zustand, vonId: Int, zuId: Int)
    fun loescheMerkposten(setNumber: String, zustand: Zustand, besitzer: Int?)
    fun uebernimmMerkposten(
        setNumber: String, zustand: Zustand, besitzer: Int?,
        anzahl: Int = 1, kaufpreisRoh: String = "", erfasstAls: Zustand? = null,
        lagerort: String? = null,
    )
    fun ladeMerkpostenDetail(setNumber: String)
    fun setzePreisalarm(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand)
}
