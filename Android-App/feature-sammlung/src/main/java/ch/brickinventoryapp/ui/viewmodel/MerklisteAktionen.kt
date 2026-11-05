package ch.brickinventoryapp.ui.viewmodel

import ch.brickinventoryapp.data.ScopeFilter

/** Was Merkliste und Merkposten-Detail auslösen; die Bildschirme kennen nur diese Schnittstelle. */
interface MerklisteAktionen {
    fun ladeMerkliste()
    fun setScope(view: ScopeFilter.View, value: String)
    fun setzeMerklisteSuche(q: String)
    fun setzeMerklisteZustand(zustand: String)
    fun setzeMerklisteSortierung(sortierung: String)
    fun legeMerkpostenAn(setNumber: String, zustand: String, besitzer: Int? = null)
    fun verschiebeMerkposten(setNumber: String, zustand: String, vonId: Int, zuId: Int)
    fun loescheMerkposten(setNumber: String, zustand: String, besitzer: Int?)
    fun uebernimmMerkposten(
        setNumber: String, zustand: String, besitzer: Int?,
        anzahl: Int = 1, kaufpreisRoh: String = "", erfasstAls: String? = null,
        lagerort: String? = null,
    )
    fun ladeMerkpostenDetail(setNumber: String)
    fun setzePreisalarm(setNumber: String, richtung: String, roh: String, zustand: String)
}
