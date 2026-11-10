package ch.brickinventoryapp.sammlung.ui.viewmodel

import ch.brickinventoryapp.model.fach.Merksortierung
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.data.model.MerklisteResponse
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.zustand.ui.abgeleitet
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.zustand.ui.Aenderung
import ch.brickinventoryapp.sammlung.ui.MerklisteUiState
import ch.brickinventoryapp.sammlung.ui.MerkpostenDetailUiState
import ch.brickinventoryapp.sammlung.ui.Preisalarmeingabe
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.zustand.ui.fehlerklasse
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.zustand.ui.Bestandssignal
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeBestand

/**
 * Merkliste und Merkposten-Detail — was man haben möchte, getrennt vom Besitz.
 *
 * Wie ein Merkposten angelegt, übernommen oder gefiltert wird, entscheidet der
 * Server (utils/merkliste.ts); hier wird nur gefragt und gezeigt. Suche,
 * Zustand und Sortierung stehen im [SavedStateHandle].
 */
@HiltViewModel
class MerklisteViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val bestand: Bestandssignal,
    private val sets: SetsRepository,
    private val katalogRepo: KatalogRepository,
    private val finanzen: FinanzenRepository,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, MerklisteAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
        folgeBestand(bestand) { beiAenderung(it) }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeKonto(view, value)
            nachFilter(view)
        }
    }

    override fun setLagerFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeLager(view, value)
            nachFilter(view)
        }
    }

    private val _merklisteState = MutableStateFlow(MerklisteUiState(
        query = gemerkt[SUCHE] ?: "",
        zustandFilter = Zustand.aus(gemerkt[ZUSTAND]),
        sortierung = Merksortierung.aus(gemerkt[SORTIERUNG]),
    ))
    /** Ein Merkposten, der erst gelöscht wird, wenn die Snackbar ohne „Rückgängig“ endet. */
    data class VorgemerkterMerkposten(val setNumber: String, val zustand: Zustand, val besitzer: Int?, val name: String)

    private val _vorgemerkt = MutableStateFlow<VorgemerkterMerkposten?>(null)
    val vorgemerkt: StateFlow<VorgemerkterMerkposten?> = _vorgemerkt.asStateFlow()

    /** Die lokale Ablage; ohne Filter ist sie die einzige Quelle der Liste. */
    private val lokal: StateFlow<Lokal<Merkposten>?> =
        sets.beobachteMerkliste().stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /**
     * Ohne Filter zeigt die Liste die Ablage — auch offline Angelegtes oder Gelöschtes
     * sofort; mit Filter die Antwort des Servers. Der vorgemerkte Posten fehlt in beiden.
     */
    val merklisteState: StateFlow<MerklisteUiState> = _merklisteState
        .abgeleitet(lokal) { st, l ->
            if (l?.stand != null && ungefiltert(st)) st.copy(merkposten = l.liste.map { m -> m.alsAnsicht() }) else st
        }
        .abgeleitet(_vorgemerkt) { st, v ->
            if (v == null) st else st.copy(merkposten = st.merkposten.filterNot { it.setNumber == v.setNumber && it.condition == v.zustand })
        }

    private val _merkpostenDetailState = MutableStateFlow(MerkpostenDetailUiState())
    val merkpostenDetailState: StateFlow<MerkpostenDetailUiState> = _merkpostenDetailState.asStateFlow()

    // Ein eigener Auftrag für die Suche: Ein neuer Tastendruck bricht den
    // wartenden Abruf ab, geladen wird erst nach der Pause.
    private var suchJob: Job? = null

    private fun ungefiltert(f: MerklisteUiState) = f.query.isBlank() && f.zustandFilter == null &&
        f.sortierung == Merksortierung.VORGABE && filter.kontoFuer(ScopeFilter.View.MERKLISTE) == null

    private val alarmEingabe = Preisalarmeingabe(
        scope = viewModelScope, sets = sets,
        melde = { meldungen.zeige(it) },
        beschreibe = { meldungen.meldungFuerSnackbar(it) },
        gespeichert = { sn ->
            if (_merkpostenDetailState.value.setNumber == sn) loadPreisalarme(sn)
            bestand.melde(Aenderung.Alarme)
        },
    )

    override fun ladeMerkliste() {
        viewModelScope.launch {
            val f = _merklisteState.value
            _merklisteState.update { it.copy(laedt = true, fehler = null) }
            // Ohne Filter schreibt der Abruf nur in die Ablage; gezeigt wird sie (merklisteState).
            val r = if (ungefiltert(f)) sets.aktualisiereMerkliste() else sets.getMerkliste(
                search    = f.query.trim().ifBlank { null },
                condition = f.zustandFilter,
                sort      = f.sortierung,
                accounts  = filter.kontoFuer(ScopeFilter.View.MERKLISTE),
            )
            when (r) {
                is Ergebnis.Success -> _merklisteState.update {
                    val vomServer = (r.data as? MerklisteResponse)?.merkposten?.map { m -> m.alsAnsicht() }
                    it.copy(merkposten = vomServer ?: it.merkposten, laedt = false)
                }
                is Ergebnis.Error -> {
                    _merklisteState.update { it.copy(laedt = false, fehler = meldungen.meldung(r),
                        fehlerKlasse = fehlerklasse(r)) }
                    meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
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

    override fun setzeMerklisteZustand(zustand: Zustand?) {
        gemerkt[ZUSTAND] = zustand?.kennung
        _merklisteState.update { it.copy(zustandFilter = zustand) }
        ladeMerkliste()
    }

    override fun setzeMerklisteSortierung(sortierung: Merksortierung) {
        gemerkt[SORTIERUNG] = sortierung.kennung
        _merklisteState.update { it.copy(sortierung = sortierung) }
        ladeMerkliste()
    }

    override fun legeMerkpostenAn(setNumber: String, zustand: Zustand, besitzer: Int?) {
        val nummer = setNumber.trim()
        if (nummer.isBlank()) { meldungen.zeige(meldungen.text(R.string.wanted_need_number)); return }
        viewModelScope.launch {
            meldungen.zeige(merkpostenAnlegen(sets, meldungen, nummer, zustand, besitzer))
            bestand.melde(Aenderung.Merkliste)
        }
    }

    override fun verschiebeMerkposten(setNumber: String, zustand: Zustand, vonId: Int, zuId: Int) {
        if (vonId == zuId) return
        viewModelScope.launch {
            when (val r = sets.verschiebeMerkposten(setNumber, zustand, vonId, zuId)) {
                is Ergebnis.Success -> {
                    if (!r.data.success) { meldungen.zeige(r.data.error ?: meldungen.text(R.string.err_unknown)); return@launch }
                    meldungen.zeige(meldungen.text(
                        if (r.data.zusammengefuehrt) R.string.wanted_already else R.string.vm_saved))
                    bestand.melde(Aenderung.Merkliste)
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /**
     * Löschen mit „Rückgängig“ wie in der Galerie: Der Posten verschwindet sofort, der
     * Server erfährt es erst mit [merkpostenLoeschenAusfuehren]. Mit ihm gingen Schwelle,
     * Richtung und „auf der Liste seit“ verloren. Ein früher vorgemerkter wird zuerst gelöscht.
     */
    override fun loescheMerkposten(setNumber: String, zustand: Zustand, besitzer: Int?) {
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
                is Ergebnis.Success -> {
                    _merklisteState.update { st -> st.copy(merkposten = st.merkposten
                        .filterNot { it.setNumber == v.setNumber && it.condition == v.zustand }) }
                    bestand.melde(Aenderung.Merkliste)
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /** Aus dem Merkposten wird Besitz; der Server entscheidet, was mit Eintrag und Alarm geschieht. */
    override fun uebernimmMerkposten(
        setNumber: String, zustand: Zustand, besitzer: Int?,
        anzahl: Int, kaufpreisRoh: String, erfasstAls: Zustand?,
        lagerort: String?,
    ) {
        viewModelScope.launch {
            val preis = Alarmeingabe.zahl(kaufpreisRoh)
            when (val r = sets.uebernimmMerkposten(setNumber, zustand, anzahl, preis,
                                                   erfasstAls, besitzer,
                                                   lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Success -> {
                    meldungen.zeige(meldungen.text(
                        if (r.data.action == "exists") R.string.wanted_taken_existing
                        else R.string.wanted_taken))
                    bestand.melde(Aenderung.Merkliste, Aenderung.Sets)
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /** Aus dem Katalog: merken und, wenn eine Schwelle dasteht, den Alarm gleich mit. */
    fun merkpostenMitAlarm(
        setNumber: String, zustand: Zustand, richtung: String, schwelleRoh: String,
        besitzer: Int? = null,
    ) {
        viewModelScope.launch {
            when (val r = sets.legeMerkpostenAn(setNumber, zustand, besitzer)) {
                is Ergebnis.Error -> {
                    meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
                    return@launch
                }
                is Ergebnis.Success -> {
                    val schwelle = Alarmeingabe.zahl(schwelleRoh)
                    if (schwelle != null) sets.setPreisalarm(setNumber, richtung, schwelle, zustand)
                    meldungen.zeige(meldungen.text(
                        if (r.data.warNeu) R.string.wanted_added else R.string.wanted_already))
                    bestand.melde(Aenderung.Merkliste, Aenderung.Alarme)
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
            val katalog = (katalogRepo.getCatalogSetDetail(setNumber) as? Ergebnis.Success)
                ?.data?.takeIf { it.success }?.set
            _merkpostenDetailState.update { it.copy(katalog = katalog?.alsAnsicht()) }
            val preise = (sets.getMerkpostenPreise(setNumber) as? Ergebnis.Success)
                ?.data?.takeIf { it.success }
            _merkpostenDetailState.update { it.copy(preise = preise?.alsAnsicht()) }
            val historie = (finanzen.getSetPriceHistory(setNumber) as? Ergebnis.Success)
                ?.data?.takeIf { it.success }
            _merkpostenDetailState.update { it.copy(historie = historie?.alsAnsicht(), laedt = false) }
        }
    }

    fun loadPreisalarme(setNumber: String) {
        viewModelScope.launch {
            val r = sets.getPreisalarme(setNumber)
            val alarme = (r as? Ergebnis.Success)?.data?.takeIf { it.success }?.alerts?.map { it.alsAnsicht() } ?: emptyList()
            _merkpostenDetailState.update { if (it.setNumber == setNumber) it.copy(preisalarme = alarme) else it }
        }
    }

    override fun setzePreisalarm(setNumber: String, richtung: String, roh: String, zustand: Zustand) =
        alarmEingabe.setze(setNumber, richtung, roh, zustand)

    private fun nachFilter(view: ScopeFilter.View) {
        if (view == ScopeFilter.View.MERKLISTE) ladeMerkliste()
    }

    private fun beiAenderung(aenderung: Aenderung) {
        if (aenderung == Aenderung.Merkliste) ladeMerkliste()
    }

    private fun zuruecksetzen() {
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
    sets: SetsRepository, texte: Texte, setNumber: String, zustand: Zustand, besitzer: Int?,
): String? = when (val r = sets.legeMerkpostenAn(setNumber, zustand, besitzer)) {
    is Ergebnis.Success -> texte.text(if (r.data.warNeu) R.string.wanted_added else R.string.wanted_already)
    is Ergebnis.Error -> texte.meldungFuerSnackbar(r)?.let { texte.text(R.string.vm_error, it) }
}
