package ch.brickinventoryapp.ui

import android.content.Context
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.TeileRepository
import dagger.hilt.android.qualifiers.ApplicationContext
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
    @param:ApplicationContext private val ctx: Context,
) : FilterAblage {
    override suspend fun konto(view: ScopeFilter.View) = ScopeFilter.flow(ctx, view).first()
    override suspend fun lager(view: ScopeFilter.View) = ScopeFilter.lagerFlow(ctx, view).first()
    override suspend fun setzeKonto(view: ScopeFilter.View, wert: String) = ScopeFilter.set(ctx, view, wert)
    override suspend fun setzeLager(view: ScopeFilter.View, wert: String) = ScopeFilter.setLager(ctx, view, wert)
    override suspend fun allesVergessen() = ScopeFilter.resetAll(ctx)
}

/**
 * Was der Nutzer gerade sieht: Kontofilter je Ansicht, Lagerortfilter, die
 * Konten des Haushalts und die Lagerorte.
 *
 * Ein Singleton, weil Galerie, Teile, Finanzen, Merkliste und Einstellungen
 * dieselben Konten und Orte zeigen. Wer einen Filter ändert, lädt danach seine
 * eigene Liste nach; der Blickfeld-Dienst selbst lädt keine Bestandsdaten.
 */
@Singleton
class Blickfeld @Inject constructor(
    private val ablage: FilterAblage,
    private val haushalt: HaushaltRepository,
    private val teile: TeileRepository,
) {
    private val _konten = MutableStateFlow(BlickfeldUiState())
    val konten: StateFlow<BlickfeldUiState> = _konten.asStateFlow()

    private val _lager = MutableStateFlow(LagerUiState())
    val lager: StateFlow<LagerUiState> = _lager.asStateFlow()

    /** Der Wert für `accounts=`, oder null für „alle Konten“. */
    fun kontoFuer(view: ScopeFilter.View): String? = ScopeFilter.asQuery(_konten.value.scopeModes[view.key])

    /** Der Wert für `storage=`, oder null für „alle Orte“. */
    fun lagerFuer(view: ScopeFilter.View): String? = ScopeFilter.lagerAsQuery(_lager.value.modi[view.key])

    suspend fun setzeKonto(view: ScopeFilter.View, wert: String) {
        ablage.setzeKonto(view, wert)
        _konten.update { it.copy(scopeModes = it.scopeModes + (view.key to wert)) }
    }

    suspend fun setzeLager(view: ScopeFilter.View, wert: String) {
        ablage.setzeLager(view, wert)
        _lager.update { it.copy(modi = it.modi + (view.key to wert)) }
    }

    /** Die gemerkten Filter aus der Ablage — einmal nach der Anmeldung. */
    suspend fun ladeFilter() {
        val konten = ScopeFilter.View.entries.associate { it.key to ablage.konto(it) }
        val lager = ScopeFilter.View.entries.associate { it.key to ablage.lager(it) }
        _konten.update { it.copy(scopeModes = konten) }
        _lager.update { it.copy(modi = lager) }
    }

    /**
     * Die Konten des Haushalts. Ein gemerkter Filter auf ein Konto, das nicht
     * mehr dazugehört, fällt auf „alle“ zurück — sonst bliebe die Liste leer,
     * ohne dass ein sichtbarer Filter es erklärt.
     */
    suspend fun ladeMitglieder() {
        val r = haushalt.getHouseholdMembers() as? Result.Success ?: return
        val mitglieder = r.data.members
        val erlaubt = ScopeFilter.options(mitglieder, "", "").map { it.first }
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
    suspend fun ladeLagerorte() {
        val r = teile.getLagerorte(kontoFuer(ScopeFilter.View.GALLERY))
        val orte = (r as? Result.Success)?.data?.takeIf { it.success }?.orte ?: return
        _lager.update { it.copy(orte = orte) }
    }

    /** Der Vorrat der Besitzer eines Sets — Vorschläge im Lagerortfeld. */
    suspend fun ladeVorrat(besitzer: List<Int>) {
        val r = teile.getLagerortVorrat(besitzer.takeIf { it.isNotEmpty() }?.joinToString(","))
        val orte = (r as? Result.Success)?.data?.takeIf { it.success }?.orte ?: return
        _lager.update { it.copy(vorrat = orte) }
    }

    /** Die eigenen Orte samt Vorgabe — für Erfassen und Verwaltung. */
    suspend fun ladeEigeneLagerorte() {
        val r = teile.getLagerortVorrat(null)
        val antwort = (r as? Result.Success)?.data?.takeIf { it.success } ?: return
        _lager.update { it.copy(eigene = antwort.orte, vorgabe = antwort.vorgabe) }
    }

    /**
     * Jede Anmeldung beginnt mit „alle Konten“: Ein Filter, der das Abmelden
     * überlebt, liesse die Sammlung beim nächsten Mal halbiert aussehen, ohne
     * dass etwas darauf hinweist. Dieselbe Regel wie in der Webapp.
     */
    suspend fun anmeldungBeginnt() {
        ablage.allesVergessen()
        zuruecksetzen()
    }

    fun zuruecksetzen() {
        _konten.value = BlickfeldUiState()
        _lager.value = LagerUiState()
    }
}
