package ch.brickinventoryapp.teile.ui.viewmodel

import ch.brickinventoryapp.teile.ui.Teilefilter
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.Listenansicht
import ch.brickinventoryapp.teile.ui.SetItemUiState
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import kotlinx.coroutines.flow.StateFlow

/**
 * Was die Bildschirme auslösen können. Sie kennen nur diese Schnittstellen, nicht die
 * ViewModels: So lassen sie sich mit einem festen Zustand und einer Attrappe zeigen,
 * ohne Hilt und ohne Server.
 */
internal interface SetItemAktionen {
    /** [colorId] zählt nur bei Teilen; eine Figur öffnet ihr eigenes ViewModel. */
    fun oeffneSetItem(nummer: String, colorId: Int = KEINE_FARBE)
    fun schliesseSetItem()
    fun setzeTeilLagerort(nummer: String, farbe: Int, ort: String)
}

/** Ein ViewModel mit dem Detail „in welchen Sets steckt das“, wie es Liste und Detail lesen. */
internal interface MitSetItem : SetItemAktionen, Filterwahl {
    val setItemState: StateFlow<SetItemUiState>
}

internal interface TeileAktionen : SetItemAktionen {
    fun loadParts(page: Int = 1, debounce: Boolean = false)
    fun loadPartsColors()
    fun setPartsQuery(q: String)
    fun setPartsSpare(wert: Ersatzteilwahl)
    fun setPartsView(wert: Listenansicht)
    fun setPartsOrdnung(wert: Teilefilter.Ordnung)
    fun setPartsColorFilter(wert: String)
    fun setPartsCategoryFilter(wert: String)
    fun setScope(view: ScopeFilter.View, value: String)
    fun setLagerFilter(view: ScopeFilter.View, value: String)
    fun loadLagerortVorrat(besitzer: List<Int>)

    fun addPart(erfassung: Teilerfassung)
    fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: Zustand? = null, owner: Int? = null)
    fun deletePart(partNumber: String, colorId: Int, owner: Int? = null)
    fun setzeTeilFarbe(partNumber: String, colorId: Int, neueFarbe: Int,
                       farbName: String? = null, farbHex: String? = null,
                       owner: Int? = null, onFertig: (Int) -> Unit = {})
}

internal interface FigurenAktionen : SetItemAktionen {
    fun loadMinifigs(debounce: Boolean = false)
    fun setMinifigsQuery(q: String)
    fun setMinifigsView(wert: Listenansicht)
    fun setScope(view: ScopeFilter.View, value: String)

    fun addMinifig(erfassung: Figurenerfassung)
    fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null,
                      condition: Zustand? = null, owner: Int? = null)
    fun deleteMinifig(figNumber: String, owner: Int? = null)

    /** Figuren haben keinen eigenen Lagerort: Sie stecken in ihrem Set. */
    override fun setzeTeilLagerort(nummer: String, farbe: Int, ort: String) = Unit
}
