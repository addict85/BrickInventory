package ch.brickinventoryapp.ui.viewmodel

import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.combine
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.ui.model.alsAnsicht
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.alarm.Alarmeingabe
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.MERKLISTE_DEFAULT_SORT
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.MerklisteUiState
import ch.brickinventoryapp.ui.MerkpostenDetailUiState
import ch.brickinventoryapp.ui.Preisalarmeingabe
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.ui.fehlerklasse

/**
 * Merkliste und Merkposten-Detail — was man haben möchte, getrennt vom Besitz.
 *
 * Wie ein Merkposten angelegt, übernommen oder gefiltert wird, entscheidet der
 * Server (utils/merkliste.ts); hier wird nur gefragt und gezeigt. Suche,
 * Zustand und Sortierung stehen im [SavedStateHandle].
 */
@HiltViewModel
class MerklisteViewModel @Inject constructor(
    dienste: AppDienste,
    private val sets: SetsRepository,
    private val katalogRepo: KatalogRepository,
    private val finanzen: FinanzenRepository,
    private val gemerkt: SavedStateHandle,
) : BereichsViewModel(dienste), MerklisteAktionen {

    private val _merklisteState = MutableStateFlow(MerklisteUiState(
        query = gemerkt[SUCHE] ?: "",
        zustandFilter = gemerkt[ZUSTAND] ?: "",
        sortierung = gemerkt[SORTIERUNG] ?: MERKLISTE_DEFAULT_SORT,
    ))
    /** Ein Merkposten, der erst gelöscht wird, wenn die Snackbar ohne „Rückgängig“ endet. */
    data class VorgemerkterMerkposten(val setNumber: String, val zustand: String, val besitzer: Int?, val name: String)

    private val _vorgemerkt = MutableStateFlow<VorgemerkterMerkposten?>(null)
    val vorgemerkt: StateFlow<VorgemerkterMerkposten?> = _vorgemerkt.asStateFlow()

    /** Die Liste ohne den vorgemerkten Posten, auch wenn sie inzwischen neu kam (wie die Galerie). */
    val merklisteState: StateFlow<MerklisteUiState> = _merklisteState
        .combine(_vorgemerkt) { st, v ->
            if (v == null) st else st.copy(merkposten = st.merkposten.filterNot { it.setNumber == v.setNumber && it.condition == v.zustand })
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, _merklisteState.value)

    private val _merkpostenDetailState = MutableStateFlow(MerkpostenDetailUiState())
    val merkpostenDetailState: StateFlow<MerkpostenDetailUiState> = _merkpostenDetailState.asStateFlow()

    // Ein eigener Auftrag für die Suche: Ein neuer Tastendruck bricht den
    // wartenden Abruf ab, geladen wird erst nach der Pause.
    private var suchJob: Job? = null

    init {
        // Ohne Filter folgt die Liste der lokalen Ablage (Room), wie die Galerie:
        // Offline Angelegtes oder Gelöschtes steht sofort da. Nicht während einer
        // Ladung — deren Antwort setzt die Liste ohnehin.
        viewModelScope.launch {
            sets.beobachteMerkliste().collect { l ->
                val f = _merklisteState.value
                if (l.stand != null && !f.laedt && ungefiltert(f))
                    _merklisteState.update { it.copy(merkposten = l.liste.map { m -> m.alsAnsicht() }) }
            }
        }
    }

    private fun ungefiltert(f: MerklisteUiState) = f.query.isBlank() && f.zustandFilter.isBlank() &&
        (f.sortierung.isBlank() || f.sortierung == MERKLISTE_DEFAULT_SORT) && scopeFor(ScopeFilter.View.MERKLISTE) == null

    private val alarmEingabe = Preisalarmeingabe(
        scope = viewModelScope, sets = sets,
        melde = { zeigeMeldung(it) },
        beschreibe = { meldungFuerSnackbar(it) },
        gespeichert = { sn ->
            if (_merkpostenDetailState.value.setNumber == sn) loadPreisalarme(sn)
            dienste.bestand.melde(Aenderung.Alarme)
        },
    )

    override fun ladeMerkliste() {
        viewModelScope.launch {
            val f = _merklisteState.value
            _merklisteState.update { it.copy(laedt = true, fehler = null) }
            val r = sets.getMerkliste(
                search    = f.query.trim().ifBlank { null },
                condition = f.zustandFilter.ifBlank { null },
                sort      = f.sortierung.ifBlank { null },
                accounts  = scopeFor(ScopeFilter.View.MERKLISTE),
            )
            when (r) {
                is Result.Success ->
                    _merklisteState.update { it.copy(merkposten = r.data.merkposten.map { m -> m.alsAnsicht() }, laedt = false) }
                is Result.Error -> {
                    _merklisteState.update { it.copy(laedt = false, fehler = meldung(r),
                        fehlerKlasse = fehlerklasse(r)) }
                    zeigeMeldung(meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) })
                }
            }
        }
    }

    override fun setzeMerklisteSuche(q: String) {
        gemerkt[SUCHE] = q
        _merklisteState.update { it.copy(query = q) }
        suchJob?.cancel()
        suchJob = viewModelScope.launch {
            delay(SUCHPAUSE_MS)
            ladeMerkliste()
        }
    }

    override fun setzeMerklisteZustand(zustand: String) {
        gemerkt[ZUSTAND] = zustand
        _merklisteState.update { it.copy(zustandFilter = zustand) }
        ladeMerkliste()
    }

    override fun setzeMerklisteSortierung(sortierung: String) {
        gemerkt[SORTIERUNG] = sortierung
        _merklisteState.update { it.copy(sortierung = sortierung) }
        ladeMerkliste()
    }

    override fun legeMerkpostenAn(setNumber: String, zustand: String, besitzer: Int?) {
        val nummer = setNumber.trim()
        if (nummer.isBlank()) { zeigeMeldung(text(R.string.wanted_need_number)); return }
        viewModelScope.launch {
            zeigeMeldung(merkpostenAnlegen(sets, dienste.texte, nummer, zustand, besitzer))
            dienste.bestand.melde(Aenderung.Merkliste)
        }
    }

    override fun verschiebeMerkposten(setNumber: String, zustand: String, vonId: Int, zuId: Int) {
        if (vonId == zuId) return
        viewModelScope.launch {
            when (val r = sets.verschiebeMerkposten(setNumber, zustand, vonId, zuId)) {
                is Result.Success -> {
                    if (!r.data.success) { zeigeMeldung(r.data.error ?: text(R.string.err_unknown)); return@launch }
                    zeigeMeldung(text(
                        if (r.data.zusammengefuehrt) R.string.wanted_already else R.string.vm_saved))
                    dienste.bestand.melde(Aenderung.Merkliste)
                }
                is Result.Error -> zeigeMeldung(meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) })
            }
        }
    }

    /**
     * Löschen mit „Rückgängig“ wie in der Galerie: Der Posten verschwindet sofort, der
     * Server erfährt es erst mit [merkpostenLoeschenAusfuehren]. Mit ihm gingen Schwelle,
     * Richtung und „auf der Liste seit“ verloren. Ein früher vorgemerkter wird zuerst gelöscht.
     */
    override fun loescheMerkposten(setNumber: String, zustand: String, besitzer: Int?) {
        merkpostenLoeschenAusfuehren()
        val name = _merklisteState.value.merkposten
            .firstOrNull { it.setNumber == setNumber && it.condition == zustand }?.name ?: setNumber
        _vorgemerkt.value = VorgemerkterMerkposten(setNumber, zustand, besitzer, name)
    }

    /** Der vorgemerkte Posten bleibt; die Liste kommt neu vom Server, wo er nie fehlte. */
    fun merkpostenRueckgaengig(nur: VorgemerkterMerkposten? = null) {
        if (_vorgemerkt.value == null || (nur != null && _vorgemerkt.value != nur)) return
        _vorgemerkt.value = null
        ladeMerkliste()
    }

    /** [nur]: nur diesen Posten — eine abgelöste Snackbar führt nicht den nächsten aus. */
    fun merkpostenLoeschenAusfuehren(nur: VorgemerkterMerkposten? = null) {
        val v = _vorgemerkt.value ?: return
        if (nur != null && v != nur) return
        _vorgemerkt.value = null
        viewModelScope.launch {
            when (val r = sets.loescheMerkposten(v.setNumber, v.zustand, v.besitzer)) {
                // „genommen“ stand schon in der Snackbar mit „Rückgängig“.
                is Result.Success -> {
                    _merklisteState.update { st -> st.copy(merkposten = st.merkposten
                        .filterNot { it.setNumber == v.setNumber && it.condition == v.zustand }) }
                    dienste.bestand.melde(Aenderung.Merkliste)
                }
                is Result.Error -> zeigeMeldung(meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) })
            }
        }
    }

    /** Aus dem Merkposten wird Besitz; der Server entscheidet, was mit Eintrag und Alarm geschieht. */
    override fun uebernimmMerkposten(
        setNumber: String, zustand: String, besitzer: Int?,
        anzahl: Int, kaufpreisRoh: String, erfasstAls: String?,
        lagerort: String?,
    ) {
        viewModelScope.launch {
            val preis = Alarmeingabe.zahl(kaufpreisRoh)
            when (val r = sets.uebernimmMerkposten(setNumber, zustand, anzahl, preis,
                                                   erfasstAls, besitzer,
                                                   lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Result.Success -> {
                    zeigeMeldung(text(
                        if (r.data.action == "exists") R.string.wanted_taken_existing
                        else R.string.wanted_taken))
                    dienste.bestand.melde(Aenderung.Merkliste, Aenderung.Sets)
                }
                is Result.Error -> zeigeMeldung(meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) })
            }
        }
    }

    /** Aus dem Katalog: merken und, wenn eine Schwelle dasteht, den Alarm gleich mit. */
    fun merkpostenMitAlarm(
        setNumber: String, zustand: String, richtung: String, schwelleRoh: String,
        besitzer: Int? = null,
    ) {
        viewModelScope.launch {
            when (val r = sets.legeMerkpostenAn(setNumber, zustand, besitzer)) {
                is Result.Error -> {
                    zeigeMeldung(meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) })
                    return@launch
                }
                is Result.Success -> {
                    val schwelle = Alarmeingabe.zahl(schwelleRoh)
                    if (schwelle != null) sets.setPreisalarm(setNumber, richtung, schwelle, zustand)
                    zeigeMeldung(text(
                        if (r.data.warNeu) R.string.wanted_added else R.string.wanted_already))
                    dienste.bestand.melde(Aenderung.Merkliste, Aenderung.Alarme)
                }
            }
        }
    }

    /** Katalogdaten, Preise und Verlauf eines Merkpostens — je für sich, was fehlt, bleibt leer. */
    override fun ladeMerkpostenDetail(setNumber: String) {
        viewModelScope.launch {
            _merkpostenDetailState.value = MerkpostenDetailUiState(setNumber = setNumber, laedt = true)
            if (_merklisteState.value.merkposten.isEmpty()) ladeMerkliste()
            loadPreisalarme(setNumber)
            val katalog = (katalogRepo.getCatalogSetDetail(setNumber) as? Result.Success)
                ?.data?.takeIf { it.success }?.set
            _merkpostenDetailState.update { it.copy(katalog = katalog?.alsAnsicht()) }
            val preise = (sets.getMerkpostenPreise(setNumber) as? Result.Success)
                ?.data?.takeIf { it.success }
            _merkpostenDetailState.update { it.copy(preise = preise?.alsAnsicht()) }
            val historie = (finanzen.getSetPriceHistory(setNumber) as? Result.Success)
                ?.data?.takeIf { it.success }
            _merkpostenDetailState.update { it.copy(historie = historie?.alsAnsicht(), laedt = false) }
        }
    }

    fun loadPreisalarme(setNumber: String) {
        viewModelScope.launch {
            val r = sets.getPreisalarme(setNumber)
            val alarme = (r as? Result.Success)?.data?.takeIf { it.success }?.alerts?.map { it.alsAnsicht() } ?: emptyList()
            _merkpostenDetailState.update { if (it.setNumber == setNumber) it.copy(preisalarme = alarme) else it }
        }
    }

    override fun setzePreisalarm(setNumber: String, richtung: String, roh: String, zustand: String) =
        alarmEingabe.setze(setNumber, richtung, roh, zustand)

    override fun nachFilter(view: ScopeFilter.View) {
        if (view == ScopeFilter.View.MERKLISTE) ladeMerkliste()
    }

    override fun beiAenderung(aenderung: Aenderung) {
        if (aenderung == Aenderung.Merkliste) ladeMerkliste()
    }

    override fun zuruecksetzen() {
        suchJob?.cancel()
        _merklisteState.value = MerklisteUiState()
        _merkpostenDetailState.value = MerkpostenDetailUiState()
    }

    private companion object {
        const val SUCHE = "merkliste_suche"
        const val ZUSTAND = "merkliste_zustand"
        const val SORTIERUNG = "merkliste_sortierung"
        const val SUCHPAUSE_MS = 350L
    }
}

/**
 * Einen Merkposten anlegen und sagen, was daraus wurde. Geteilt mit der
 * Erfassung: Ein Scan aus der Merkliste heraus legt ebenfalls einen an.
 */
internal suspend fun merkpostenAnlegen(
    sets: SetsRepository, texte: Texte, setNumber: String, zustand: String, besitzer: Int?,
): String? = when (val r = sets.legeMerkpostenAn(setNumber, zustand, besitzer)) {
    is Result.Success -> texte.text(if (r.data.warNeu) R.string.wanted_added else R.string.wanted_already)
    is Result.Error -> texte.meldungFuerSnackbar(r)?.let { texte.text(R.string.vm_error, it) }
}
