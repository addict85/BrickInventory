package ch.brickinventoryapp.zustand.ui.viewmodel

import ch.brickinventoryapp.model.fach.Kontoauswahl
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.koroutinen.ApplicationScope
import ch.brickinventoryapp.zustand.ui.Blickfeld
import ch.brickinventoryapp.zustand.ui.BlickfeldUiState
import ch.brickinventoryapp.zustand.ui.LagerUiState
import ch.brickinventoryapp.sitzung.Sitzung
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Meldungen in den einen Kanal der App, samt den Texten, aus denen sie entstehen. */
interface Meldungen : Texte {
    /** Null zeigt nichts. */
    fun zeige(text: String?)

    /** Eine überholte Meldung zurücknehmen, etwa nach einem gelungenen zweiten Scan. */
    fun quittiere()
}

/** Für Tests ohne Hilt. */
fun Meldungen(kanal: MeldungsKanal, texte: Texte): Meldungen = AppMeldungen(kanal, texte)

class AppMeldungen @Inject constructor(
    private val kanal: MeldungsKanal,
    texte: Texte,
) : Meldungen, Texte by texte {
    override fun zeige(text: String?) = kanal.zeige(text)
    override fun quittiere() = kanal.quittiere()
}

/**
 * Konto- und Lagerortfilter, wie ein Bereich sie zeigt und setzt. Die Bildschirme
 * lesen `blickfeld` und `lagerState` am ViewModel; dieses reicht die Filterwahl
 * per Delegation durch, statt sie von einer Basisklasse zu erben.
 */
interface Filterwahl {
    val blickfeld: StateFlow<BlickfeldUiState>
    val lagerState: StateFlow<LagerUiState>

    /** Der Wert für `accounts=`, oder null für „alle Konten“. */
    fun kontoFuer(view: ScopeFilter.View): Kontoauswahl?

    /** Der Wert für `storage=`, oder null für „alle Orte“. */
    fun lagerFuer(view: ScopeFilter.View): String?

    fun setScope(view: ScopeFilter.View, value: String)
    fun setLagerFilter(view: ScopeFilter.View, value: String)

    /** Vorschläge fürs Lagerortfeld: die Orte der Besitzer des gezeigten Eintrags. */
    fun loadLagerortVorrat(besitzer: List<Int>)

    /** Die eigenen Orte samt Vorgabe — für die Erfassungsdialoge. */
    fun ladeEigeneLagerorte()

    /** Für Bereiche, die nach dem Setzen ihre Liste neu laden. */
    suspend fun setzeKonto(view: ScopeFilter.View, value: String)
    suspend fun setzeLager(view: ScopeFilter.View, value: String)

    /** Nach einer Änderung im Bereich, deren Ergebnis der Aufrufer abwartet. */
    suspend fun ladeMitglieder()
    suspend fun ladeLagerorte()
    suspend fun eigeneLagerorteNeu()
}

/** Für Tests ohne Hilt. */
fun Filterwahl(dienst: Blickfeld, bereich: CoroutineScope): Filterwahl = BereichsFilter(dienst, bereich)

/**
 * Im Bereich der App: Ein Filter, den jemand gesetzt hat, wird gemerkt, auch wenn
 * der Bildschirm gleich danach verschwindet. Der Blickfeld-Zustand ist ein
 * Singleton und verträgt jeden Faden.
 */
class BereichsFilter @Inject constructor(
    private val dienst: Blickfeld,
    @param:ApplicationScope private val bereich: CoroutineScope,
) : Filterwahl {
    override val blickfeld: StateFlow<BlickfeldUiState> = dienst.konten
    override val lagerState: StateFlow<LagerUiState> = dienst.lager
    override fun kontoFuer(view: ScopeFilter.View) = dienst.kontoFuer(view)
    override fun lagerFuer(view: ScopeFilter.View) = dienst.lagerFuer(view)
    override fun setScope(view: ScopeFilter.View, value: String) { bereich.launch { setzeKonto(view, value) } }
    override fun setLagerFilter(view: ScopeFilter.View, value: String) { bereich.launch { setzeLager(view, value) } }
    override fun loadLagerortVorrat(besitzer: List<Int>) { bereich.launch { dienst.ladeVorrat(besitzer) } }
    override fun ladeEigeneLagerorte() { bereich.launch { dienst.ladeEigeneLagerorte() } }
    override suspend fun setzeKonto(view: ScopeFilter.View, value: String) = dienst.setzeKonto(view, value)
    override suspend fun setzeLager(view: ScopeFilter.View, value: String) = dienst.setzeLager(view, value)
    override suspend fun ladeMitglieder() = dienst.ladeMitglieder()
    override suspend fun ladeLagerorte() = dienst.ladeLagerorte()
    override suspend fun eigeneLagerorteNeu() = dienst.ladeEigeneLagerorte()
}

/**
 * Nach einer Abmeldung leert der Bereich, was dem vorigen Konto gehörte; der
 * nächste Nutzer auf demselben Gerät sähe es sonst. drop(1): Der Zähler steht
 * beim Sammeln schon auf seinem Wert, und der ist keine neue Abmeldung.
 */
fun ViewModel.folgeAbmeldung(sitzung: Sitzung, zuruecksetzen: () -> Unit) {
    viewModelScope.launch { sitzung.abmeldungen.drop(1).collect { zuruecksetzen() } }
}

/**
 * Lädt, sobald [zustand] seinen ersten Beobachter bekommt, und wieder nach jeder Pause ohne:
 * Das Betreten der Seite stösst das Laden an, nicht ein LaunchedEffect des Bildschirms.
 * Kein stateIn, damit `.value` auch ohne Beobachter stimmt.
 */
fun ViewModel.ladeBeimBeobachten(zustand: MutableStateFlow<*>, laden: () -> Unit) {
    viewModelScope.launch {
        zustand.subscriptionCount.map { it > 0 }.distinctUntilChanged().collect { if (it) laden() }
    }
}
