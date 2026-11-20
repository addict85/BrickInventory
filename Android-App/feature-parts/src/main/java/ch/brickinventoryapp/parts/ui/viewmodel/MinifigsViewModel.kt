package ch.brickinventoryapp.parts.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.Figurenerfassung
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.session.abgeleitet
import ch.brickinventoryapp.parts.ui.Figuren
import ch.brickinventoryapp.parts.ui.MinifigsLocal
import ch.brickinventoryapp.parts.ui.MinifigsUiState
import ch.brickinventoryapp.parts.ui.SetItemFlow
import ch.brickinventoryapp.parts.ui.SetItemUiState
import ch.brickinventoryapp.parts.ui.PartsSessionUiState
import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.Loeschvormerkung
import ch.brickinventoryapp.model.domain.Figurenordnung
import kotlinx.coroutines.flow.MutableStateFlow
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Der Figuren-Reiter: Liste, Suche, Erfassen und Ändern manueller Figuren, dazu der
 * Dialog „in welchen Sets steckt diese Figur“. Suche und Ansicht liegen im
 * [SavedStateHandle], der Kontofilter nicht.
 */
@HiltViewModel
class MinifigsViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val changes: Bestandsabgleich,
    private val figuren: MinifigsRepository,
    private val kontosicht: Kontosicht,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, FigurenAktionen, WithSetItem {

    internal val sessionValues: StateFlow<PartsSessionUiState> =
        sitzung.state.abgeleitet { PartsSessionUiState(it.serverUrl, it.currency, it.userDefaultCondition) }

    init {
        sequenceSignOut(sitzung) { reset() }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setAccount(view, value)
            if (view == ScopeFilter.View.MINIFIGS) loadMinifigs()
        }
    }

    private val konto get() = filter.accountFor(ScopeFilter.View.MINIFIGS)

    private fun abfrage(st: MinifigsUiState): Kontosicht.MinifigsQuery? =
        konto?.let { Kontosicht.MinifigsQuery(it, st.minifigsQuery.ifBlank { null }) }

    private val liste = Figuren(
        scope = viewModelScope,
        reportError = { meldungen.zeige(meldungen.meldungFuerSnackbar(it)) },
        listen = MinifigsLocal(
            figuren = { st -> abfrage(st)?.let { kontosicht.figurenliste.observe(it) }
                ?: figuren.observeMinifigs(st.minifigsQuery) },
            manualMinifigs = { st -> abfrage(st)?.let { kontosicht.manualMinifigs.observe(it) }
                ?: figuren.observeManualMinifigs(st.minifigsQuery) },
            refresh = { st -> refresh(st) },
            metrics = { figuren.getMinifigStats(konto) },
        ),
    )

    private suspend fun refresh(st: MinifigsUiState): Ergebnis<Unit> {
        val a = abfrage(st) ?: return figuren.refreshMinifigs()
        val r = kontosicht.figurenliste.refresh(a)
        return if (r is Ergebnis.Fehler) r else kontosicht.manualMinifigs.refresh(a)
    }

    /** Eine manuelle Figur, die erst gelöscht wird, wenn die Snackbar ohne „Rückgängig“ endet. */
    data class ReservedMinifig(val figNumber: String, val owner: Int?, val name: String)

    val loeschen = Loeschvormerkung<ReservedMinifig>(viewModelScope) { v ->
        val r = figuren.deleteMinifig(v.figNumber, v.owner)
        if (r is Ergebnis.Fehler) meldungen.zeige(meldungen.meldungFuerSnackbar(r))
    }

    private val order = MutableStateFlow(gemerkt[F_ORDER] ?: Figurenordnung.DEFAULT)

    private val minifigsObserved = Observed(liste.zustand
        .abgeleitet(order) { st, o -> st.copy(minifigs = o.sort(st.minifigs), order = o) }
        .abgeleitet(loeschen.wert) { st, v ->
            if (v == null) st else st.copy(manualFigs = st.manualFigs?.filterNot {
                it.figNumber == v.figNumber && (v.owner == null || it.userId == v.owner) })
        })
    val minifigsState: StateFlow<MinifigsUiState> = minifigsObserved

    private val inSets = SetItemFlow(viewModelScope, Postenart.FIG,
        abfrage = { nummer, _ -> figuren.getSetsWithMinifig(nummer, konto) },
        afterHeader = filter::loadLocationStock)
    override val setItemState: StateFlow<SetItemUiState> = inSets.zustand

    init {
        viewModelScope.launch { changes.minifigsChanged().collect { liste.loadMetrics() } }
        liste.placeAgain(gemerkt[F_SEARCH] ?: "", gemerkt[F_VIEW] ?: ListView.KARTEN)
        // Nur eine leere Liste holen: Die Ablage hält sie danach selbst aktuell.
        loadPerServer(sitzung, minifigsObserved) { if (liste.zustand.value.minifigs.isEmpty()) loadMinifigs() }
    }

    override fun loadMinifigs(debounce: Boolean) = liste.laden(debounced = debounce)

    override fun setMinifigsQuery(q: String) { gemerkt[F_SEARCH] = q; liste.setzeSuche(q) }
    override fun setMinifigsView(wert: ListView) { gemerkt[F_VIEW] = wert; liste.setView(wert) }

    override fun addMinifig(erfassung: Figurenerfassung) {
        val e = erfassung
        viewModelScope.launch {
            when (val r = figuren.addMinifig(e.nummer.trim(), e.blNumber, e.menge, e.stueckpreis,
                                          e.zustand, e.besitzer,
                                          e.lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Erfolg -> meldungen.zeige(entryMessage(meldungen, r.data.angelegt, r.data.nummer, r.data.priceFromState))
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String?,
                      condition: Zustand?, owner: Int?) =
        aendere(meldungen, meldungen.text(R.string.vm_saved)) {
            figuren.updateMinifig(figNumber, quantity, unitPrice, blFigNumber, condition, owner)
        }

    override fun minifigDeleteReserve(figNumber: String, owner: Int?, name: String) =
        loeschen.reserve(ReservedMinifig(figNumber, owner, name))

    override fun setMinifigsOrder(wert: Figurenordnung) {
        gemerkt[F_ORDER] = wert
        order.value = wert
    }

    override fun deleteMinifig(figNumber: String, owner: Int?) =
        aendere(meldungen, meldungen.text(R.string.vm_minifig_deleted)) {
            figuren.deleteMinifig(figNumber, owner)
        }

    override fun openSetItem(nummer: String, colorId: Int) = inSets.oeffne(nummer, colorId)

    override fun closeSetItem() = inSets.schliesse()

    override fun setPartLocation(nummer: String, farbe: Int, ort: String) = Unit

    private fun reset() {
        liste.reset()
        inSets.schliesse()
        gemerkt.remove<String>(F_SEARCH)
        gemerkt.remove<ListView>(F_VIEW)
        gemerkt.remove<Figurenordnung>(F_ORDER)
        order.value = Figurenordnung.DEFAULT
    }

    private companion object {
        const val F_SEARCH = "figuren_suche"
        const val F_VIEW = "figuren_ansicht"
        const val F_ORDER = "figuren_ordnung"
    }
}
