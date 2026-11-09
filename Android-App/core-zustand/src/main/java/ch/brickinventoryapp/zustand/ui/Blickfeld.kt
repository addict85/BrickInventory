package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.ScopeFilterSpeicher
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.model.ui.model.kontoOptionen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/** Wo die gewählten Filter je Ansicht liegen — im Gerät eine DataStore-Datei, im Test eine Map. */
interface FilterAblage {
    suspend fun konto(view: ScopeFilter.View): String
    suspend fun lager(view: ScopeFilter.View): String
    suspend fun setzeKonto(view: ScopeFilter.View, wert: String)
    suspend fun setzeLager(view: ScopeFilter.View, wert: String)
    suspend fun allesVergessen()
}

class ScopeFilterAblage @Inject constructor(
    private val speicher: ScopeFilterSpeicher,
) : FilterAblage {
    override suspend fun konto(view: ScopeFilter.View) = speicher.flow(view).first()
    override suspend fun lager(view: ScopeFilter.View) = speicher.lagerFlow(view).first()
    override suspend fun setzeKonto(view: ScopeFilter.View, wert: String) = speicher.set(view, wert)
    override suspend fun setzeLager(view: ScopeFilter.View, wert: String) = speicher.setLager(view, wert)
    override suspend fun allesVergessen() = speicher.resetAll()
}

/**
 * Was der Nutzer gerade sieht: Kontofilter je Ansicht, Lagerortfilter, die
 * Konten des Haushalts und die Lagerorte.
 *
 * Ein Singleton, weil Galerie, Teile, Finanzen, Merkliste und Einstellungen
 * dieselben Konten und Orte zeigen. Wer einen Filter ändert, lädt danach seine
 * eigene Liste nach; der Blickfeld-Dienst selbst lädt keine Bestandsdaten.
 */
interface Blickfeld {
    val konten: StateFlow<BlickfeldUiState>
    val lager: StateFlow<LagerUiState>
    fun kontoFuer(view: ScopeFilter.View): String?
    fun lagerFuer(view: ScopeFilter.View): String?
    suspend fun setzeKonto(view: ScopeFilter.View, wert: String)
    suspend fun setzeLager(view: ScopeFilter.View, wert: String)
    suspend fun ladeFilter()
    suspend fun ladeMitglieder()
    suspend fun ladeLagerorte()
    suspend fun ladeVorrat(besitzer: List<Int>)
    suspend fun ladeEigeneLagerorte()
    suspend fun anmeldungBeginnt()
    fun zuruecksetzen()
}

/** Für Tests ohne Hilt. */
fun Blickfeld(
    ablage: FilterAblage,
    haushalt: HaushaltRepository,
    teile: TeileRepository,
): Blickfeld = BlickfeldDienst(ablage, haushalt, teile)

@Singleton
class BlickfeldDienst @Inject constructor(
    private val ablage: FilterAblage,
    private val haushalt: HaushaltRepository,
    private val teile: TeileRepository,
) : Blickfeld {
    private val _konten = MutableStateFlow(BlickfeldUiState())
    override val konten: StateFlow<BlickfeldUiState> = _konten.asStateFlow()

    private val _lager = MutableStateFlow(LagerUiState())
    override val lager: StateFlow<LagerUiState> = _lager.asStateFlow()

    /** Der Wert für `accounts=`, oder null für „alle Konten“. */
    override fun kontoFuer(view: ScopeFilter.View): String? = ScopeFilter.asQuery(_konten.value.scopeModes[view])

    /** Der Wert für `storage=`, oder null für „alle Orte“. */
    override fun lagerFuer(view: ScopeFilter.View): String? = ScopeFilter.lagerAsQuery(_lager.value.modi[view])

    override suspend fun setzeKonto(view: ScopeFilter.View, wert: String) {
        ablage.setzeKonto(view, wert)
        _konten.update { it.copy(scopeModes = it.scopeModes + (view to wert)) }
    }

    override suspend fun setzeLager(view: ScopeFilter.View, wert: String) {
        ablage.setzeLager(view, wert)
        _lager.update { it.copy(modi = it.modi + (view to wert)) }
    }

    /** Die gemerkten Filter aus der Ablage — einmal nach der Anmeldung. */
    override suspend fun ladeFilter() {
        val konten = ScopeFilter.View.entries.associateWith { ablage.konto(it) }
        val lager = ScopeFilter.View.entries.associateWith { ablage.lager(it) }
        _konten.update { it.copy(scopeModes = konten) }
        _lager.update { it.copy(modi = lager) }
    }

    /**
     * Die Konten des Haushalts. Ein gemerkter Filter auf ein Konto, das nicht
     * mehr dazugehört, fällt auf „alle“ zurück — sonst bliebe die Liste leer,
     * ohne dass ein sichtbarer Filter es erklärt.
     */
    override suspend fun ladeMitglieder() {
        val r = haushalt.getHouseholdMembers() as? Ergebnis.Success ?: return
        val mitglieder = r.data.members.map { it.alsAnsicht() }
        val erlaubt = kontoOptionen(mitglieder, "", "").map { it.first }
        _konten.update { st ->
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
        val r = teile.getLagerorte(kontoFuer(ScopeFilter.View.GALLERY))
        val orte = (r as? Ergebnis.Success)?.data?.takeIf { it.success }?.orte ?: return
        _lager.update { it.copy(orte = orte.map { o -> o.alsAnsicht() }) }
    }

    /** Der Vorrat der Besitzer eines Sets — Vorschläge im Lagerortfeld. */
    override suspend fun ladeVorrat(besitzer: List<Int>) {
        val r = teile.getLagerortVorrat(besitzer.takeIf { it.isNotEmpty() }?.joinToString(","))
        val orte = (r as? Ergebnis.Success)?.data?.takeIf { it.success }?.orte ?: return
        _lager.update { it.copy(vorrat = orte.map { o -> o.alsAnsicht() }) }
    }

    /** Die eigenen Orte samt Vorgabe — für Erfassen und Verwaltung. */
    override suspend fun ladeEigeneLagerorte() {
        val r = teile.getLagerortVorrat(null)
        val antwort = (r as? Ergebnis.Success)?.data?.takeIf { it.success } ?: return
        _lager.update { it.copy(eigene = antwort.orte.map { o -> o.alsAnsicht() }, vorgabe = antwort.vorgabe?.alsAnsicht()) }
    }

    /**
     * Jede Anmeldung beginnt mit „alle Konten“: Ein Filter, der das Abmelden
     * überlebt, liesse die Sammlung beim nächsten Mal halbiert aussehen, ohne
     * dass etwas darauf hinweist. Dieselbe Regel wie in der Webapp.
     */
    override suspend fun anmeldungBeginnt() {
        ablage.allesVergessen()
        zuruecksetzen()
    }

    override fun zuruecksetzen() {
        _konten.value = BlickfeldUiState()
        _lager.value = LagerUiState()
    }
}
