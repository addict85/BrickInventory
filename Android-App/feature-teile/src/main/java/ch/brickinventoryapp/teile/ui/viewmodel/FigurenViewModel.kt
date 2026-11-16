package ch.brickinventoryapp.teile.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.Listenansicht
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.sitzung.abgeleitet
import ch.brickinventoryapp.teile.ui.Figuren
import ch.brickinventoryapp.teile.ui.FigurenLokal
import ch.brickinventoryapp.teile.ui.FigurenUiState
import ch.brickinventoryapp.teile.ui.SetItemAblauf
import ch.brickinventoryapp.teile.ui.SetItemUiState
import ch.brickinventoryapp.teile.ui.TeileSitzungUiState
import ch.brickinventoryapp.zustand.ui.viewmodel.Beobachtet
import ch.brickinventoryapp.zustand.ui.viewmodel.Loeschvormerkung
import ch.brickinventoryapp.model.fach.Figurenordnung
import kotlinx.coroutines.flow.MutableStateFlow
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung
import ch.brickinventoryapp.zustand.ui.viewmodel.ladeJeServer
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
class FigurenViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val aenderungen: Bestandsabgleich,
    private val figuren: FigurenRepository,
    private val kontosicht: Kontosicht,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, FigurenAktionen, MitSetItem {

    internal val sitzungsWerte: StateFlow<TeileSitzungUiState> =
        sitzung.state.abgeleitet { TeileSitzungUiState(it.serverUrl, it.currency, it.userDefaultCondition) }

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeKonto(view, value)
            if (view == ScopeFilter.View.MINIFIGS) loadMinifigs()
        }
    }

    private val konto get() = filter.kontoFuer(ScopeFilter.View.MINIFIGS)

    private fun abfrage(st: FigurenUiState): Kontosicht.FigurenAbfrage? =
        konto?.let { Kontosicht.FigurenAbfrage(it, st.minifigsQuery.ifBlank { null }) }

    private val liste = Figuren(
        scope = viewModelScope,
        meldeFehler = { meldungen.zeige(meldungen.meldungFuerSnackbar(it)) },
        listen = FigurenLokal(
            figuren = { st -> abfrage(st)?.let { kontosicht.figurenliste.beobachte(it) }
                ?: figuren.beobachteFiguren(st.minifigsQuery) },
            manuelleFiguren = { st -> abfrage(st)?.let { kontosicht.manuelleFiguren.beobachte(it) }
                ?: figuren.beobachteManuelleFiguren(st.minifigsQuery) },
            aktualisiere = { st -> aktualisiere(st) },
            kennzahlen = { figuren.getMinifigStats(konto) },
        ),
    )

    private suspend fun aktualisiere(st: FigurenUiState): Ergebnis<Unit> {
        val a = abfrage(st) ?: return figuren.aktualisiereFiguren()
        val r = kontosicht.figurenliste.aktualisiere(a)
        return if (r is Ergebnis.Fehler) r else kontosicht.manuelleFiguren.aktualisiere(a)
    }

    /** Eine manuelle Figur, die erst gelöscht wird, wenn die Snackbar ohne „Rückgängig“ endet. */
    data class VorgemerkteFigur(val figNumber: String, val owner: Int?, val name: String)

    val loeschen = Loeschvormerkung<VorgemerkteFigur>(viewModelScope) { v ->
        val r = figuren.deleteMinifig(v.figNumber, v.owner)
        if (r is Ergebnis.Fehler) meldungen.zeige(meldungen.meldungFuerSnackbar(r))
    }

    private val ordnung = MutableStateFlow(gemerkt[F_ORDNUNG] ?: Figurenordnung.VORGABE)

    private val figurenBeobachtet = Beobachtet(liste.zustand
        .abgeleitet(ordnung) { st, o -> st.copy(minifigs = o.sortiere(st.minifigs), ordnung = o) }
        .abgeleitet(loeschen.wert) { st, v ->
            if (v == null) st else st.copy(manualFigs = st.manualFigs?.filterNot {
                it.figNumber == v.figNumber && (v.owner == null || it.userId == v.owner) })
        })
    val figurenZustand: StateFlow<FigurenUiState> = figurenBeobachtet

    private val inSets = SetItemAblauf(viewModelScope, Postenart.FIG,
        abfrage = { nummer, _ -> figuren.getSetsMitFigur(nummer, konto) },
        nachKopf = filter::loadLagerortVorrat)
    override val setItemState: StateFlow<SetItemUiState> = inSets.zustand

    init {
        viewModelScope.launch { aenderungen.figurenGeaendert().collect { liste.ladeKennzahlen() } }
        liste.stelleWieder(gemerkt[F_SUCHE] ?: "", gemerkt[F_ANSICHT] ?: Listenansicht.KARTEN)
        // Nur eine leere Liste holen: Die Ablage hält sie danach selbst aktuell.
        ladeJeServer(sitzung, figurenBeobachtet) { if (liste.zustand.value.minifigs.isEmpty()) loadMinifigs() }
    }

    override fun loadMinifigs(debounce: Boolean) = liste.laden(entprellt = debounce)

    override fun setMinifigsQuery(q: String) { gemerkt[F_SUCHE] = q; liste.setzeSuche(q) }
    override fun setMinifigsView(wert: Listenansicht) { gemerkt[F_ANSICHT] = wert; liste.setzeAnsicht(wert) }

    override fun addMinifig(erfassung: Figurenerfassung) {
        val e = erfassung
        viewModelScope.launch {
            when (val r = figuren.addMinifig(e.nummer.trim(), e.blNummer, e.menge, e.stueckpreis,
                                          e.zustand, e.besitzer,
                                          e.lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Erfolg -> meldungen.zeige(erfassungsMeldung(meldungen, r.data.angelegt, r.data.nummer, r.data.preisAusZustand))
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String?,
                      condition: Zustand?, owner: Int?) =
        aendere(meldungen, meldungen.text(R.string.vm_saved)) {
            figuren.updateMinifig(figNumber, quantity, unitPrice, blFigNumber, condition, owner)
        }

    override fun figurLoeschenVormerken(figNumber: String, owner: Int?, name: String) =
        loeschen.vormerken(VorgemerkteFigur(figNumber, owner, name))

    override fun setMinifigsOrdnung(wert: Figurenordnung) {
        gemerkt[F_ORDNUNG] = wert
        ordnung.value = wert
    }

    override fun deleteMinifig(figNumber: String, owner: Int?) =
        aendere(meldungen, meldungen.text(R.string.vm_minifig_deleted)) {
            figuren.deleteMinifig(figNumber, owner)
        }

    override fun oeffneSetItem(nummer: String, colorId: Int) = inSets.oeffne(nummer, colorId)

    override fun schliesseSetItem() = inSets.schliesse()

    override fun setzeTeilLagerort(nummer: String, farbe: Int, ort: String) = Unit

    private fun zuruecksetzen() {
        liste.zuruecksetzen()
        inSets.schliesse()
        gemerkt.remove<String>(F_SUCHE)
        gemerkt.remove<Listenansicht>(F_ANSICHT)
        gemerkt.remove<Figurenordnung>(F_ORDNUNG)
        ordnung.value = Figurenordnung.VORGABE
    }

    private companion object {
        const val F_SUCHE = "figuren_suche"
        const val F_ANSICHT = "figuren_ansicht"
        const val F_ORDNUNG = "figuren_ordnung"
    }
}
