package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.ui.model.alsAnsicht
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.alarm.Alarmeingabe
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.data.repository.MERKLISTE_DEFAULT_SORT
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.ui.MerklisteUiState
import ch.brickinventoryapp.ui.MerkpostenDetailUiState
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.ui.Preisalarmeingabe
import dagger.hilt.android.lifecycle.HiltViewModel
import ch.brickinventoryapp.ui.model.alsAnsicht
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import ch.brickinventoryapp.ui.model.alsAnsicht
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import ch.brickinventoryapp.ui.model.alsAnsicht
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import ch.brickinventoryapp.ui.model.alsAnsicht
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.ui.model.alsAnsicht

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
) : BereichsViewModel(dienste) {

    private val _merklisteState = MutableStateFlow(MerklisteUiState(
        query = gemerkt[SUCHE] ?: "",
        zustandFilter = gemerkt[ZUSTAND] ?: "",
        sortierung = gemerkt[SORTIERUNG] ?: MERKLISTE_DEFAULT_SORT,
    ))
    val merklisteState: StateFlow<MerklisteUiState> = _merklisteState.asStateFlow()

    private val _merkpostenDetailState = MutableStateFlow(MerkpostenDetailUiState())
    val merkpostenDetailState: StateFlow<MerkpostenDetailUiState> = _merkpostenDetailState.asStateFlow()

    // Ein eigener Auftrag für die Suche: Ein neuer Tastendruck bricht den
    // wartenden Abruf ab, geladen wird erst nach der Pause.
    private var suchJob: Job? = null

    private val alarmEingabe = Preisalarmeingabe(
        scope = viewModelScope, sets = sets,
        melde = { _snackbar.value = it },
        beschreibe = { meldungFuerSnackbar(it) },
        gespeichert = { sn ->
            if (_merkpostenDetailState.value.setNumber == sn) loadPreisalarme(sn)
            dienste.bestand.melde(Aenderung.Alarme)
        },
    )

    fun ladeMerkliste() {
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
                    _merklisteState.update { it.copy(merkposten = r.data.merkposten, laedt = false) }
                is Result.Error -> {
                    _merklisteState.update { it.copy(laedt = false, fehler = meldung(r)) }
                    _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
                }
            }
        }
    }

    fun setzeMerklisteSuche(q: String) {
        gemerkt[SUCHE] = q
        _merklisteState.update { it.copy(query = q) }
        suchJob?.cancel()
        suchJob = viewModelScope.launch {
            delay(SUCHPAUSE_MS)
            ladeMerkliste()
        }
    }

    fun setzeMerklisteZustand(zustand: String) {
        gemerkt[ZUSTAND] = zustand
        _merklisteState.update { it.copy(zustandFilter = zustand) }
        ladeMerkliste()
    }

    fun setzeMerklisteSortierung(sortierung: String) {
        gemerkt[SORTIERUNG] = sortierung
        _merklisteState.update { it.copy(sortierung = sortierung) }
        ladeMerkliste()
    }

    fun legeMerkpostenAn(setNumber: String, zustand: String, besitzer: Int? = null) {
        val nummer = setNumber.trim()
        if (nummer.isBlank()) { _snackbar.value = text(R.string.wanted_need_number); return }
        viewModelScope.launch {
            _snackbar.value = merkpostenAnlegen(sets, dienste.texte, nummer, zustand, besitzer)
            dienste.bestand.melde(Aenderung.Merkliste)
        }
    }

    fun verschiebeMerkposten(setNumber: String, zustand: String, vonId: Int, zuId: Int) {
        if (vonId == zuId) return
        viewModelScope.launch {
            when (val r = sets.verschiebeMerkposten(setNumber, zustand, vonId, zuId)) {
                is Result.Success -> {
                    if (!r.data.success) { _snackbar.value = r.data.error ?: text(R.string.err_unknown); return@launch }
                    _snackbar.value = text(
                        if (r.data.zusammengefuehrt) R.string.wanted_already else R.string.vm_saved)
                    dienste.bestand.melde(Aenderung.Merkliste)
                }
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
            }
        }
    }

    fun loescheMerkposten(setNumber: String, zustand: String, besitzer: Int?) {
        viewModelScope.launch {
            when (val r = sets.loescheMerkposten(setNumber, zustand, besitzer)) {
                is Result.Success -> {
                    _snackbar.value = text(R.string.wanted_deleted)
                    dienste.bestand.melde(Aenderung.Merkliste)
                }
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
            }
        }
    }

    /** Aus dem Merkposten wird Besitz; der Server entscheidet, was mit Eintrag und Alarm geschieht. */
    fun uebernimmMerkposten(
        setNumber: String, zustand: String, besitzer: Int?,
        anzahl: Int = 1, kaufpreisRoh: String = "", erfasstAls: String? = null,
        lagerort: String? = null,
    ) {
        viewModelScope.launch {
            val preis = Alarmeingabe.zahl(kaufpreisRoh)
            when (val r = sets.uebernimmMerkposten(setNumber, zustand, anzahl, preis,
                                                   erfasstAls, besitzer,
                                                   lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Result.Success -> {
                    _snackbar.value = text(
                        if (r.data.action == "exists") R.string.wanted_taken_existing
                        else R.string.wanted_taken)
                    dienste.bestand.melde(Aenderung.Merkliste, Aenderung.Sets)
                }
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
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
                    _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
                    return@launch
                }
                is Result.Success -> {
                    val schwelle = Alarmeingabe.zahl(schwelleRoh)
                    if (schwelle != null) sets.setPreisalarm(setNumber, richtung, schwelle, zustand)
                    _snackbar.value = text(
                        if (r.data.warNeu) R.string.wanted_added else R.string.wanted_already)
                    dienste.bestand.melde(Aenderung.Merkliste, Aenderung.Alarme)
                }
            }
        }
    }

    /** Katalogdaten, Preise und Verlauf eines Merkpostens — je für sich, was fehlt, bleibt leer. */
    fun ladeMerkpostenDetail(setNumber: String) {
        viewModelScope.launch {
            _merkpostenDetailState.value = MerkpostenDetailUiState(setNumber = setNumber, laedt = true)
            if (_merklisteState.value.merkposten.isEmpty()) ladeMerkliste()
            loadPreisalarme(setNumber)
            val katalog = (katalogRepo.getCatalogSetDetail(setNumber) as? Result.Success)
                ?.data?.takeIf { it.success }?.set
            _merkpostenDetailState.update { it.copy(katalog = katalog) }
            val preise = (sets.getMerkpostenPreise(setNumber) as? Result.Success)
                ?.data?.takeIf { it.success }
            _merkpostenDetailState.update { it.copy(preise = preise) }
            val historie = (finanzen.getSetPriceHistory(setNumber) as? Result.Success)
                ?.data?.takeIf { it.success }
            _merkpostenDetailState.update { it.copy(historie = historie, laedt = false) }
        }
    }

    fun loadPreisalarme(setNumber: String) {
        viewModelScope.launch {
            val r = sets.getPreisalarme(setNumber)
            val alarme = (r as? Result.Success)?.data?.takeIf { it.success }?.alerts?.map { it.alsAnsicht() } ?: emptyList()
            _merkpostenDetailState.update { if (it.setNumber == setNumber) it.copy(preisalarme = alarme) else it }
        }
    }

    fun setzePreisalarm(setNumber: String, richtung: String, roh: String, zustand: String) =
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
