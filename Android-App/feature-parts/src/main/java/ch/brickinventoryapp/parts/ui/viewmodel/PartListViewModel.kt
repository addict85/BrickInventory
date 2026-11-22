package ch.brickinventoryapp.parts.ui.viewmodel

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.withoutError
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Teilelistenauftrag
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.service.ExportResult
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import ch.brickinventoryapp.data.service.PartListsExport
import ch.brickinventoryapp.parts.ui.TeilelisteUiState
import ch.brickinventoryapp.parts.ui.PartListsSource
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.PlSet
import ch.brickinventoryapp.parts.ui.RemovedSet
import ch.brickinventoryapp.parts.ui.normalized
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut

/**
 * The build list: collect sets, resolve them, compare the stock, generate a PDF. The list and
 * running fetches live here, so that a rotation does not discard them; the set numbers
 * additionally live in the [SavedStateHandle], so the way to the scanner never costs them.
 */
@HiltViewModel
class PartListViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val meldungen: Meldungen,
    private val quelle: PartListsSource,
    private val export: PartListsExport,
    private val gemerkt: SavedStateHandle,
) : ViewModel() {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        sequenceSignOut(sitzung) { reset() }
    }

    private val _zustand = MutableStateFlow(
        TeilelisteUiState(sets = gemerkt.get<ArrayList<String>>(SETS).orEmpty().map { PlSet(it, it) }),
    )
    val zustand: StateFlow<TeilelisteUiState> = _zustand.asStateFlow()

    val pdfExportStatus: StateFlow<String?> =
        export.fortschritt.map { it?.let(::progressText) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private fun setList(neu: (TeilelisteUiState) -> TeilelisteUiState) {
        _zustand.update(neu)
        gemerkt[SETS] = ArrayList(_zustand.value.sets.map { it.setNumber })
    }

    fun addAdd(nr: String) {
        val nummer = normalized(nr)
        // The number is named by the header above the sets; the status stays for errors and the result.
        setList { z ->
            if (z.sets.any { it.setNumber == nummer }) z.copy(status = Meldung.Resource(R.string.partslist_set_already_added))
            else z.copy(sets = z.sets + PlSet(nummer, nummer), status = null)
        }
    }

    fun entferne(index: Int) = setList { z ->
        val set = z.sets.getOrNull(index) ?: return@setList z
        z.copy(sets = z.sets.filterIndexed { i, _ -> i != index }, generated = false,
            removed = RemovedSet(set, z.sets, z.generated))
    }

    /**
     * „Undo“ after removing. Unchanged since then: the old list comes back, generated or not.
     * Changed: the set returns to its place, and the list has to be created anew.
     */
    fun undoRemove(r: RemovedSet) = setList { z ->
        when {
            z.sets == r.before.filter { it != r.set } -> z.copy(sets = r.before, generated = r.wasGenerated, removed = null)
            z.sets.any { it.setNumber == r.set.setNumber } -> z.copy(removed = null)
            else -> {
                val platz = r.before.indexOf(r.set).coerceIn(0, z.sets.size)
                z.copy(sets = z.sets.toMutableList().apply { add(platz, r.set) }, generated = false, removed = null)
            }
        }
    }

    /** The snackbar ended without „Undo“; a newer removal keeps its own. */
    fun removalSeen(r: RemovedSet) = _zustand.update { if (it.removed == r) it.copy(removed = null) else it }

    /** "Zurücksetzen" on the list: sets and parts gone, the switches' choice stays. */
    fun leere() = setList { it.copy(sets = emptyList(), parts = emptyList(), status = null, generated = false, removed = null) }

    private fun reset() {
        _zustand.value = TeilelisteUiState()
        gemerkt[SETS] = ArrayList<String>()
    }

    fun setOnlyLose(an: Boolean) = _zustand.update { it.copy(onlyLose = an) }
    fun setWithSubAccounts(an: Boolean) = _zustand.update { it.copy(withSubAccounts = an) }

    /**
     * One step instead of two: what stands in the field is added on creating. Identical
     * parts across several sets (BrickLink number and color) are counted together.
     */
    fun erstelle(eingabe: String) {
        if (eingabe.isNotBlank()) addAdd(eingabe)
        val start = _zustand.value
        if (start.sets.isEmpty() || start.erzeugen.laedt) return
        setList { it.copy(erzeugen = Laden.Loads, generated = false, parts = emptyList()) }
        viewModelScope.launch {
            val server = sitzung.state.value.serverUrl
            val combined = linkedMapOf<String, PlPart>()
            val sets = start.sets
            sets.forEachIndexed { i, s ->
                _zustand.update { it.copy(status = Meldung.Resource(R.string.partslist_loading_set, listOf(s.setNumber, i + 1, sets.size))) }
                try {
                    val (name, neu) = quelle.resolveSetOn(s.setNumber, server)
                    setList { z -> z.copy(sets = z.sets.map { if (it.setNumber == s.setNumber) it.copy(name = name) else it }) }
                    neu.forEach { p ->
                        val key = "${p.blPartNumber ?: p.partNumber}|${p.colorName}"
                        combined[key] = combined[key]?.let { it.copy(quantity = it.quantity + p.quantity) } ?: p
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    _zustand.update { it.copy(status = Meldung.Resource(R.string.partslist_error_for_set, listOf(s.setNumber))) }
                }
            }
            val parts = quelle.sortiert(combined.values)
            // Two numbers, two matches: one <plurals> matches only ONE
            // of them, hence two fragments and a frame.
            val stueck = parts.sumOf { it.quantity }
            val status = Meldung.Resource(R.string.partslist_summary, listOf(
                Meldung.Menge(R.plurals.partslist_summary_types, parts.size),
                Meldung.Menge(R.plurals.partslist_summary_parts, stueck)))
            _zustand.update { it.copy(parts = parts, status = status, erzeugen = Laden.Daten(Unit), generated = true) }
        }
    }

    /** "Kann ich das bauen?" — enters one's own stock into the finished list. */
    fun loadInventory() {
        val z = _zustand.value
        if (z.bestand.laeuft || z.parts.isEmpty()) return
        _zustand.update { it.copy(bestand = Vorgang.Laeuft) }
        viewModelScope.launch {
            val neu = quelle.withInventory(z.parts, z.onlyLose, z.withSubAccounts)
            if (neu == null) {
                _zustand.update { it.copy(bestand = Vorgang.Fertig, status = Meldung.Resource(R.string.partslist_owned_error)) }
                return@launch
            }
            val fehlen = neu.filter { (it.vorhanden ?: 0) < it.quantity }
            val missingPiece = fehlen.sumOf { it.quantity - (it.vorhanden ?: 0) }
            // The singular form leaves out the parenthesis: if exactly ONE part is missing, the
            // count of distinct ones is also one.
            val status = if (fehlen.isEmpty()) Meldung.Resource(R.string.partslist_owned_complete)
            else Meldung.Menge(R.plurals.partslist_owned_missing, missingPiece,
                listOf(missingPiece, Meldung.Menge(R.plurals.partslist_owned_missing_distinct, fehlen.size)))
            _zustand.update { it.copy(parts = neu, bestand = Vorgang.Fertig, status = status) }
        }
    }

    /** Starts the export as a service; the screen offers the finished PDF for opening. */
    fun exportiere() {
        val z = _zustand.value
        if (z.pdf.laeuft || z.parts.isEmpty()) return
        _zustand.update { it.copy(pdf = Vorgang.Laeuft) }
        viewModelScope.launch {
            val ergebnis = export.erzeuge(exportJob(z.sets, z.parts))
            _zustand.update {
                when (ergebnis) {
                    is ExportResult.Datei -> it.copy(pdf = Vorgang.Fertig, pdfFile = ergebnis.datei)
                    is ExportResult.Fehler -> it.copy(pdf = Vorgang.Fehlgeschlagen(errorText(ergebnis.grund)))
                }
            }
        }
    }

    private fun progressText(f: PdfProgress): String = when (f.schritt) {
        PdfStep.STARTET -> meldungen.text(R.string.pdfexp_starting)
        PdfStep.IMAGES_LOAD -> meldungen.text(R.string.pdfexp_loading_images)
        PdfStep.CREATED -> f.restSeconds?.takeIf { it > 0 }?.let { meldungen.text(R.string.pdfexp_creating_eta, it) }
            ?: meldungen.text(R.string.pdfexp_almost_done)
        PdfStep.COMPLETION -> meldungen.text(R.string.pdfexp_finalizing)
        PdfStep.DOWNLOAD -> meldungen.text(R.string.pdfexp_downloading)
    }

    /** Never empty: a fetch speaks like every fetch, a failed job with the server's sentence. */
    private fun errorText(grund: PdfFailure): Meldung = when (grund) {
        is PdfFailure.Abruf -> errorMessage(grund.fehler)
        is PdfFailure.Auftrag -> grund.satz?.takeIf { it.isNotBlank() }?.let(Meldung::Text)
            ?: Meldung.Resource(R.string.pdfexp_server_error)
    }

    fun pdfOpened() = _zustand.update { it.copy(pdfFile = null) }
    fun pdfErrorSeen() = _zustand.update { it.copy(pdf = it.pdf.withoutError()) }

    private fun exportJob(sets: List<PlSet>, parts: List<PlPart>): Teilelistenauftrag {
        val serverUrl = sitzung.state.value.serverUrl.trimEnd('/')
        return Teilelistenauftrag(
            sets = sets.map { Teilelistenauftrag.Set(nummer = it.setNumber, name = it.name) },
            zeilen = parts.map { p ->
                val imgUrl = p.imageUrl ?: ""
                Teilelistenauftrag.Zeile(nummer = p.partNumber, blNumber = p.blPartNumber ?: p.partNumber, name = p.partName,
                    farbname = p.colorName, farbHex = p.colorHex ?: "", farbId = p.colorId, menge = p.quantity,
                    bildLokal = p.imageLocal ?: "",
                    bild = if (imgUrl.startsWith(serverUrl)) imgUrl.removePrefix(serverUrl) else imgUrl, figur = p.isFig)
            },
        )
    }

    private companion object {
        const val SETS = "teileliste_sets"
    }
}
