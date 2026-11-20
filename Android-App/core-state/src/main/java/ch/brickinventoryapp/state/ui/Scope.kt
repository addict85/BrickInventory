package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.session.Filterquelle
import ch.brickinventoryapp.model.domain.Kontoauswahl
import ch.brickinventoryapp.data.ScopeFilterStorage
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.model.domain.accountOptions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/** Wo die gewählten Filter je Ansicht liegen — im Gerät eine DataStore-Datei, im Test eine Map. */
interface FilterStore {
    suspend fun konto(view: ScopeFilter.View): String
    suspend fun lager(view: ScopeFilter.View): String
    suspend fun setAccount(view: ScopeFilter.View, wert: String)
    suspend fun setzeLager(view: ScopeFilter.View, wert: String)
    suspend fun everythingForgotten()
}

class ScopeFilterStore @Inject constructor(
    private val speicher: ScopeFilterStorage,
) : FilterStore {
    override suspend fun konto(view: ScopeFilter.View) = speicher.flow(view).first()
    override suspend fun lager(view: ScopeFilter.View) = speicher.storageFlow(view).first()
    override suspend fun setAccount(view: ScopeFilter.View, wert: String) = speicher.set(view, wert)
    override suspend fun setzeLager(view: ScopeFilter.View, wert: String) = speicher.setLager(view, wert)
    override suspend fun everythingForgotten() = speicher.resetAll()
}

/**
 * Was der Nutzer gerade sieht: Kontofilter je Ansicht, Lagerortfilter, die
 * Konten des Haushalts und die Lagerorte.
 *
 * Ein Singleton, weil Galerie, Teile, Finanzen, Merkliste und Einstellungen
 * dieselben Konten und Orte zeigen. Wer einen Filter ändert, lädt danach seine
 * eigene Liste nach; der Blickfeld-Dienst selbst lädt keine Bestandsdaten.
 */
interface Scope : Filterquelle {
    val konten: StateFlow<ScopeUiState>
    val lager: StateFlow<LagerUiState>
    fun accountFor(view: ScopeFilter.View): Kontoauswahl?
    fun storageFor(view: ScopeFilter.View): String?
    suspend fun setAccount(view: ScopeFilter.View, wert: String)
    suspend fun setzeLager(view: ScopeFilter.View, wert: String)
    suspend fun loadStock(besitzer: List<Int>)
    suspend fun loginBegins()
    fun reset()
}

/** Für Tests ohne Hilt. */
fun Scope(
    ablage: FilterStore,
    haushalt: HouseholdRepository,
    teile: PartsRepository,
): Scope = ScopeService(ablage, haushalt, teile)

@Singleton
class ScopeService @Inject constructor(
    private val ablage: FilterStore,
    private val haushalt: HouseholdRepository,
    private val teile: PartsRepository,
) : Scope {
    private val _accounts = MutableStateFlow(ScopeUiState())
    override val konten: StateFlow<ScopeUiState> = _accounts.asStateFlow()

    private val _storage = MutableStateFlow(LagerUiState())
    override val lager: StateFlow<LagerUiState> = _storage.asStateFlow()

    /** Wessen Bestand die Ansicht zeigt, oder null für „alle Konten“. */
    override fun accountFor(view: ScopeFilter.View): Kontoauswahl? =
        Kontoauswahl.aus(ScopeFilter.asQuery(_accounts.value.scopeModes[view]))

    /** Der Wert für `storage=`, oder null für „alle Orte“. */
    override fun storageFor(view: ScopeFilter.View): String? = ScopeFilter.storageAsQuery(_storage.value.modi[view])

    override suspend fun setAccount(view: ScopeFilter.View, wert: String) {
        ablage.setAccount(view, wert)
        _accounts.update { it.copy(scopeModes = it.scopeModes + (view to wert)) }
    }

    override suspend fun setzeLager(view: ScopeFilter.View, wert: String) {
        ablage.setzeLager(view, wert)
        _storage.update { it.copy(modi = it.modi + (view to wert)) }
    }

    /** Die gemerkten Filter aus der Ablage — einmal nach der Anmeldung. */
    override suspend fun loadFilter() {
        val konten = ScopeFilter.View.entries.associateWith { ablage.konto(it) }
        val lager = ScopeFilter.View.entries.associateWith { ablage.lager(it) }
        _accounts.update { it.copy(scopeModes = konten) }
        _storage.update { it.copy(modi = lager) }
    }

    /**
     * Die Konten des Haushalts. Ein gemerkter Filter auf ein Konto, das nicht
     * mehr dazugehört, fällt auf „alle“ zurück — sonst bliebe die Liste leer,
     * ohne dass ein sichtbarer Filter es erklärt.
     */
    override suspend fun loadMembers() {
        val r = haushalt.getHouseholdMembers() as? Ergebnis.Erfolg ?: return
        val mitglieder = r.data
        val erlaubt = accountOptions(mitglieder, "", "").map { it.first }
        _accounts.update { st ->
            st.copy(
                householdMembers = mitglieder,
                scopeModes = st.scopeModes.mapValues { (_, v) ->
                    if (erlaubt.isEmpty() || v in erlaubt) v else ScopeFilter.ALL
                },
            )
        }
    }

    /** Die belegten Orte im Blickfeld der Galerie — sie speisen den Lagerfilter. */
    override suspend fun ladeLagerorte() {
        val r = teile.getLocations(accountFor(ScopeFilter.View.GALLERY))
        val orte = (r as? Ergebnis.Erfolg)?.data ?: return
        _storage.update { it.copy(orte = orte) }
    }

    /** Der Vorrat der Besitzer eines Sets — Vorschläge im Lagerortfeld. */
    override suspend fun loadStock(besitzer: List<Int>) {
        val r = teile.getLocationStock(besitzer)
        val orte = (r as? Ergebnis.Erfolg)?.data ?: return
        _storage.update { it.copy(stock = orte) }
    }

    /** Die eigenen Orte samt Vorgabe — für Erfassen und Verwaltung; gezeigt wird, was die Ablage danach hat. */
    override suspend fun loadOwnLocations() {
        teile.refreshLocationStock()
        val stock = teile.observeLocationStock().first().liste
        _storage.update {
            it.copy(eigene = stock.map { v -> v.ort }, vorgabe = stock.firstOrNull { v -> v.vorgabe }?.ort)
        }
    }

    /**
     * Jede Anmeldung beginnt mit „alle Konten“: Ein Filter, der das Abmelden
     * überlebt, liesse die Sammlung beim nächsten Mal halbiert aussehen, ohne
     * dass etwas darauf hinweist. Dieselbe Regel wie in der Webapp.
     */
    override suspend fun loginBegins() {
        ablage.everythingForgotten()
        reset()
    }

    override fun reset() {
        _accounts.value = ScopeUiState()
        _storage.value = LagerUiState()
    }
}
