package ch.brickinventoryapp.parts.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.service.ExportResult
import ch.brickinventoryapp.data.service.PartListsExport
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.model.domain.PartListJob
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.parts.ui.PartListUiState
import ch.brickinventoryapp.parts.ui.PartListUiState.RemovedSet
import ch.brickinventoryapp.parts.ui.PartListsSource
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.PlSet
import ch.brickinventoryapp.parts.ui.normalized
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import ch.brickinventoryapp.uistate.Load
import ch.brickinventoryapp.uistate.Operation
import ch.brickinventoryapp.uistate.loading
import ch.brickinventoryapp.uistate.running
import ch.brickinventoryapp.uistate.withoutError
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The build list: collect sets, resolve them, compare the stock, generate a PDF. The list and
 * running fetches live here, so that a rotation does not discard them; the set numbers
 * additionally live in the [SavedStateHandle], so the way to the scanner never costs them.
 */
@HiltViewModel
class PartListViewModel @Inject constructor(
    private val session: Session,
    private val messages: Messages,
    private val source: PartListsSource,
    private val export: PartListsExport,
    private val wanted: SavedStateHandle,
) : ViewModel() {

    val state: StateFlow<AppUiState> = session.state

    init {
        logoutSequence(session) { reset() }
    }

    private val _uiState = MutableStateFlow(
        PartListUiState(sets = wanted.get<ArrayList<String>>(SETS).orEmpty().map { PlSet(it, it) }),
    )
    val uiState: StateFlow<PartListUiState> = _uiState.asStateFlow()

    val pdfExportStatus: StateFlow<String?> =
        export.progress.map { it?.let(::progressText) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private fun setList(newValue: (PartListUiState) -> PartListUiState) {
        _uiState.update(newValue)
        wanted[SETS] = ArrayList(_uiState.value.sets.map { it.setNumber })
    }

    fun addAdd(nr: String) {
        val number = normalized(nr)
        // The number is named by the header above the sets; the status stays for errors and the result.
        setList { z ->
            if (z.sets.any { it.setNumber == number }) z.copy(status = Message.Resource(R.string.partslist_set_already_added))
            else z.copy(sets = z.sets + PlSet(number, number), status = null)
        }
    }

    fun remove(index: Int) = setList { z ->
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
                val space = r.before.indexOf(r.set).coerceIn(0, z.sets.size)
                z.copy(sets = z.sets.toMutableList().apply { add(space, r.set) }, generated = false, removed = null)
            }
        }
    }

    /** The snackbar ended without „Undo“; a newer removal keeps its own. */
    fun removalSeen(r: RemovedSet) = _uiState.update { if (it.removed == r) it.copy(removed = null) else it }

    /** "Zurücksetzen" on the list: sets and parts gone, the switches' choice stays. */
    fun empty() = setList { it.copy(sets = emptyList(), parts = emptyList(), status = null, generated = false, removed = null) }

    private fun reset() {
        _uiState.value = PartListUiState()
        wanted[SETS] = ArrayList<String>()
    }

    fun setOnlyLose(an: Boolean) = _uiState.update { it.copy(onlyLose = an) }
    fun setWithSubAccounts(an: Boolean) = _uiState.update { it.copy(withSubAccounts = an) }

    /**
     * One step instead of two: what stands in the field is added on creating. Identical
     * parts across several sets (BrickLink number and color) are counted together.
     */
    fun createNow(input: String) {
        if (input.isNotBlank()) addAdd(input)
        val start = _uiState.value
        if (start.sets.isEmpty() || start.generating.loading) return
        setList { it.copy(generating = Load.Loads, generated = false, parts = emptyList()) }
        viewModelScope.launch {
            val server = session.state.value.serverUrl
            val combined = linkedMapOf<String, PlPart>()
            val sets = start.sets
            sets.forEachIndexed { i, s ->
                _uiState.update { it.copy(status = Message.Resource(R.string.partslist_loading_set, listOf(s.setNumber, i + 1, sets.size))) }
                when (val r = source.resolveSetOn(s.setNumber, server)) {
                    is Outcome.Success -> {
                        val (name, newValue) = r.data
                        setList { z -> z.copy(sets = z.sets.map { if (it.setNumber == s.setNumber) it.copy(name = name) else it }) }
                        newValue.forEach { p ->
                            val key = "${p.blPartNumber ?: p.partNumber}|${p.colorName}"
                            combined[key] = combined[key]?.let { it.copy(quantity = it.quantity + p.quantity) } ?: p
                        }
                    }
                    is Outcome.Failure ->
                        _uiState.update { it.copy(status = Message.Resource(R.string.partslist_error_for_set, listOf(s.setNumber))) }
                }
            }
            val parts = source.sorted(combined.values)
            // Two numbers, two matches: one <plurals> matches only ONE
            // of them, hence two fragments and a frame.
            val piece = parts.sumOf { it.quantity }
            val status = Message.Resource(R.string.partslist_summary, listOf(
                Message.Quantity(R.plurals.partslist_summary_types, parts.size),
                Message.Quantity(R.plurals.partslist_summary_parts, piece)))
            _uiState.update { it.copy(parts = parts, status = status, generating = Load.Data(Unit), generated = true) }
        }
    }

    /** "Kann ich das bauen?" — enters one's own stock into the finished list. */
    fun loadInventory() {
        val z = _uiState.value
        if (z.stock.running || z.parts.isEmpty()) return
        _uiState.update { it.copy(stock = Operation.Running) }
        viewModelScope.launch {
            val newValue = source.withInventory(z.parts, z.onlyLose, z.withSubAccounts)
            if (newValue == null) {
                _uiState.update { it.copy(stock = Operation.Done, status = Message.Resource(R.string.partslist_owned_error)) }
                return@launch
            }
            val missing = newValue.filter { (it.present ?: 0) < it.quantity }
            val missingPiece = missing.sumOf { it.quantity - (it.present ?: 0) }
            // The singular form leaves out the parenthesis: if exactly ONE part is missing, the
            // count of distinct ones is also one.
            val status = if (missing.isEmpty()) Message.Resource(R.string.partslist_owned_complete)
            else Message.Quantity(R.plurals.partslist_owned_missing, missingPiece,
                listOf(missingPiece, Message.Quantity(R.plurals.partslist_owned_missing_distinct, missing.size)))
            _uiState.update { it.copy(parts = newValue, stock = Operation.Done, status = status) }
        }
    }

    /** Starts the export as a service; the screen offers the finished PDF for opening. */
    fun export() {
        val z = _uiState.value
        if (z.pdf.running || z.parts.isEmpty()) return
        _uiState.update { it.copy(pdf = Operation.Running) }
        viewModelScope.launch {
            val outcome = export.generate(exportJob(z.sets, z.parts))
            _uiState.update {
                when (outcome) {
                    is ExportResult.FileEntry -> it.copy(pdf = Operation.Done, pdfFile = outcome.file)
                    is ExportResult.Failure -> it.copy(pdf = Operation.Failed(errorText(outcome.reason)))
                }
            }
        }
    }

    private fun progressText(f: PdfProgress): String = when (f.step) {
        PdfStep.STARTING -> messages.text(R.string.pdfexp_starting)
        PdfStep.IMAGES_LOAD -> messages.text(R.string.pdfexp_loading_images)
        PdfStep.CREATED -> f.restSeconds?.takeIf { it > 0 }?.let { messages.text(R.string.pdfexp_creating_eta, it) }
            ?: messages.text(R.string.pdfexp_almost_done)
        PdfStep.COMPLETION -> messages.text(R.string.pdfexp_finalizing)
        PdfStep.DOWNLOAD -> messages.text(R.string.pdfexp_downloading)
    }

    /** Never empty: a fetch speaks like every fetch, a failed job with the server's sentence. */
    private fun errorText(reason: PdfFailure): Message = when (reason) {
        is PdfFailure.Fetch -> errorMessage(reason.error)
        is PdfFailure.Job -> reason.sentence?.takeIf { it.isNotBlank() }?.let(Message::Text)
            ?: Message.Resource(R.string.pdfexp_server_error)
    }

    fun pdfOpened() = _uiState.update { it.copy(pdfFile = null) }
    fun pdfErrorSeen() = _uiState.update { it.copy(pdf = it.pdf.withoutError()) }

    private fun exportJob(sets: List<PlSet>, parts: List<PlPart>): PartListJob {
        val serverUrl = session.state.value.serverUrl.trimEnd('/')
        return PartListJob(
            sets = sets.map { PartListJob.Set(number = it.setNumber, name = it.name) },
            rows = parts.map { p ->
                val imgUrl = p.imageUrl ?: ""
                PartListJob.Row(number = p.partNumber, blNumber = p.blPartNumber ?: p.partNumber, name = p.partName,
                    colorName = p.colorName, colorHex = p.colorHex ?: "", colorId = p.colorId, quantity = p.quantity,
                    imageLocal = p.imageLocal ?: "",
                    image = if (imgUrl.startsWith(serverUrl)) imgUrl.removePrefix(serverUrl) else imgUrl, figure = p.isFig)
            },
        )
    }

    private companion object {
        const val SETS = "teileliste_sets"
    }
}
