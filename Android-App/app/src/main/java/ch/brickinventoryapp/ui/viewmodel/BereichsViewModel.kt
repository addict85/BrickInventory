package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.AppUiState
import ch.brickinventoryapp.ui.Bestandssignal
import ch.brickinventoryapp.ui.Blickfeld
import ch.brickinventoryapp.ui.BlickfeldUiState
import ch.brickinventoryapp.ui.LagerUiState
import ch.brickinventoryapp.ui.ScrollMemory
import ch.brickinventoryapp.ui.Sitzung
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Was jedes Bereichs-ViewModel braucht, in einem Paket. Ohne das trüge jedes
 * der ViewModels dieselben sechs Konstruktorparameter, und ein siebter Dienst
 * hiesse, zehn Konstruktoren und zehn Tests anzufassen.
 */
class AppDienste @Inject constructor(
    val sitzung: Sitzung,
    val blickfeld: Blickfeld,
    val meldungen: MeldungsKanal,
    val texte: Texte,
    val bestand: Bestandssignal,
    val scrollMemory: ScrollMemory,
)

/**
 * Grundlage der Bereichs-ViewModels (Galerie, Teile, Set-Detail, …).
 *
 * Sie liefert die gemeinsamen Flüsse unter den Namen, die die Bildschirme schon
 * lesen (`state`, `blickfeld`, `lagerState`), und zwei Haken: Nach einer
 * Abmeldung leert [zuruecksetzen] den eigenen Zustand, nach einer Änderung
 * anderswo entscheidet [beiAenderung], ob nachgeladen wird.
 */
abstract class BereichsViewModel(protected val dienste: AppDienste) : ViewModel() {

    val state: StateFlow<AppUiState> = dienste.sitzung.state
    val blickfeld: StateFlow<BlickfeldUiState> = dienste.blickfeld.konten
    val lagerState: StateFlow<LagerUiState> = dienste.blickfeld.lager

    /** Der eine Meldungskanal der App — siehe MeldungsKanal. */
    protected val _snackbar: MutableStateFlow<String?> = dienste.meldungen.fluss

    protected fun text(id: Int, vararg args: Any?): String = dienste.texte.text(id, *args)
    protected fun menge(id: Int, anzahl: Int, vararg args: Any?): String = dienste.texte.menge(id, anzahl, *args)
    protected fun meldung(fehler: Result.Error): String = dienste.texte.meldung(fehler)
    protected fun meldungFuerSnackbar(fehler: Result.Error): String? = dienste.texte.meldungFuerSnackbar(fehler)

    protected fun scopeFor(view: ScopeFilter.View): String? = dienste.blickfeld.kontoFuer(view)
    protected fun lagerFor(view: ScopeFilter.View): String? = dienste.blickfeld.lagerFuer(view)

    init {
        viewModelScope.launch { dienste.sitzung.abmeldungen.collect { zuruecksetzen() } }
        viewModelScope.launch { dienste.bestand.aenderungen.collect { beiAenderung(it) } }
    }

    /** Kontofilter einer Ansicht ändern; danach lädt der Bereich nach ([nachFilter]). */
    fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            dienste.blickfeld.setzeKonto(view, value)
            nachFilter(view)
        }
    }

    fun setLagerFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            dienste.blickfeld.setzeLager(view, value)
            nachFilter(view)
        }
    }

    /** Ein Filter der Ansicht [view] hat sich geändert. */
    protected open fun nachFilter(view: ScopeFilter.View) {}

    /** Nach dem Abmelden: alles vergessen, was dem vorigen Konto gehörte. */
    protected open fun zuruecksetzen() {}

    /** Ein anderer Bereich hat den Bestand geändert. */
    protected open fun beiAenderung(aenderung: Aenderung) {}
}
