package ch.brickinventoryapp.collection.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.CheckPhase
import ch.brickinventoryapp.collection.ui.Entry
import ch.brickinventoryapp.collection.ui.EntryUiState
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.catalog.CatalogRepository
import ch.brickinventoryapp.data.catalog.SetCatalogRepository
import ch.brickinventoryapp.data.collection.SetsRepository
import ch.brickinventoryapp.data.collection.WantedRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.model.ui.ScannerOrigin
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Entering sets: barcode and text recognition, entering via the set number
 * (gallery, catalog) and the "checking" display.
 *
 * Tied to the destination that scans or enters (Erfassungsrahmen): the scanner
 * hands its result back there, checking and confirmation sit above that
 * destination, and no other destination reads the results.
 */
@HiltViewModel
class EntryViewModel @Inject constructor(
    private val session: Session,
    private val filter: FilterChoice,
    private val messages: Messages,
    private val sets: SetsRepository,
    private val setCatalog: SetCatalogRepository,
    private val wantedList: WantedRepository,
    private val catalog: CatalogRepository,
    private val creator: SetCreator,
) : ViewModel(), FilterChoice by filter, EntryActions {

    val state: StateFlow<AppUiState> = session.state

    init {
        logoutSequence(session) { reset() }
    }

    private val _barcodeState = MutableStateFlow(BarcodeUiState())
    val barcodeState: StateFlow<BarcodeUiState> = _barcodeState.asStateFlow()

    private val entryVm = Entry()
    val entryState: StateFlow<EntryUiState> = entryVm.state

    /**
     * A scan's running check, so it can be canceled —
     * the other end hangs if you want to keep scanning anyway. Creating
     * itself isn't here: it already writes and can't be
     * canceled without consequences.
     */
    private var entryJob: Job? = null

    /**
     * Resolve a barcode. The checking display stands until the question is answered;
     * a new scan cancels the old one, otherwise the display would answer
     * a question nobody is asking anymore.
     */
    fun resolveBarcode(value: String, origin: ScannerOrigin = ScannerOrigin.GALLERY) {
        entryJob?.cancel()
        _barcodeState.update { it.copy(source = origin) }
        entryJob = viewModelScope.launch {
            // Six return paths, four of them early: only the `finally` reliably
            // clears the display.
            try {
                entryVm.show(value, CheckPhase.BARCODE)
                when (val r = setCatalog.resolveBarcode(value)) {
                    is Outcome.Success -> {
                        val setNum = r.data.setNumber
                        if (setNum.isBlank()) {
                            messages.show(messages.text(R.string.vm_barcode_not_found, value))
                            _barcodeState.update { it.copy(requestManualEntry = true) }
                            return@launch
                        }
                        if (_barcodeState.value.source == ScannerOrigin.GALLERY_FILTER) {
                            messages.acknowledge()
                            _barcodeState.update { it.copy(searchFor = setNum) }
                            return@launch
                        }
                        if (_barcodeState.value.source == ScannerOrigin.GALLERY_SEARCH && showExisting(setNum)) return@launch
                        messages.acknowledge()
                        _barcodeState.update { it.copy(
                            result = setNum, setName = r.data.name ?: setNum,
                            imageUrl = r.data.imageUrl, imageLocal = r.data.imageLocal,
                            year = r.data.year, pieces = r.data.pieces, theme = r.data.theme,
                            minifigs = r.data.minifigs, unsafe = r.data.unsafe, add = Operation.Done,
                            ownershipQuantity = 0,
                        ) }
                        // "Already in your collection (×N)": the catalog knows one's own
                        // inventory; its own job, so the checking display doesn't wait on it.
                        viewModelScope.launch {
                            val response = catalog.getCatalogSetDetail(setNum)
                            val ownership = if (response is Outcome.Success) response.data else null
                            if (ownership?.owned == true && _barcodeState.value.result == setNum)
                                _barcodeState.update { it.copy(ownershipQuantity = ownership.ownedQuantity.coerceAtLeast(1)) }
                        }
                    }
                    is Outcome.Failure -> {
                        // "Not found" only if the server says so; a network error
                        // tells you nothing about the barcode.
                        messages.show(if (r.code == ErrorCode.BARCODE_NO_SET) messages.text(R.string.vm_barcode_not_found, value)
                                          else messages.messageForSnackbar(r))
                        _barcodeState.update { it.copy(result = null, requestManualEntry = true) }
                    }
                }
            } finally {
                entryVm.done()
            }
        }
    }

    /**
     * Take over a recognized set number (text recognition). The
     * server is asked whether the set is already in view — not the loaded list,
     * which only knows one page and not the sub-accounts.
     */
    fun useScannedSetNumber(raw: String, origin: ScannerOrigin = ScannerOrigin.GALLERY) {
        entryJob?.cancel()
        _barcodeState.update { it.copy(source = origin) }
        entryJob = viewModelScope.launch {
            try {
                val setNum = raw.trim().let { if (it.contains("-")) it else "$it-1" }
                entryVm.show(setNum, CheckPhase.STOCK)
                val fromList = _barcodeState.value.source in setOf(ScannerOrigin.PART_LIST, ScannerOrigin.WANTED_LIST)
                if (!fromList && showExisting(setNum)) return@launch
                when (val r = catalog.getCatalogSetDetail(setNum)) {
                    is Outcome.Success -> {
                        val d = r.data
                        if (d == null) {
                            messages.show(messages.text(R.string.vm_barcode_not_found, setNum))
                            _barcodeState.update { it.copy(requestManualEntry = true) }
                            return@launch
                        }
                        messages.acknowledge()
                        _barcodeState.update { it.copy(
                            result = d.setNumber, setName = d.name ?: d.setNumber,
                            imageUrl = d.imageUrl, imageLocal = d.imageLocal,
                            year = d.year, pieces = d.numParts, theme = d.themeName,
                            minifigs = d.minifigs, unsafe = true, add = Operation.Done,
                            ownershipQuantity = if (d.owned) d.ownedQuantity.coerceAtLeast(1) else 0,
                        ) }
                    }
                    is Outcome.Failure -> {
                        messages.show(messages.messageForSnackbar(r))
                        _barcodeState.update { it.copy(requestManualEntry = true) }
                    }
                }
            } finally {
                entryVm.done()
            }
        }
    }

    /**
     * Is the set already in view? Then the gallery opens it, and it
     * isn't entered. True means: done (found or error reported).
     */
    private suspend fun showExisting(setNum: String): Boolean {
        entryVm.show(setNum, CheckPhase.STOCK)
        return when (val present = setCatalog.getSetExists(setNum)) {
            is Outcome.Success -> {
                val found = present.data
                if (found != null) {
                    messages.acknowledge()
                    _barcodeState.update { it.copy(foundSet = found) }
                }
                found != null
            }
            is Outcome.Failure -> {
                messages.show(messages.messageForSnackbar(present))
                true
            }
        }
    }

    /** The gallery has navigated to the found set. */
    fun gallerySearchFoundConsumed() {
        _barcodeState.update { it.copy(foundSet = null) }
    }

    /** The gallery has put the scanned set number into its search. */
    fun searchForConsumed() {
        _barcodeState.update { it.copy(searchFor = null) }
    }

    /** The confirmation dialog after a scan: watchlist, hand to the parts list, or enter. */
    override fun confirmAddBarcode(wish: EntryRequest) {
        val setNum = wish.setNumber
        val state = _barcodeState.value
        if (state.add.running) return
        when (state.source) {
            ScannerOrigin.WANTED_LIST -> {
                viewModelScope.launch {
                    messages.show(createWantedItem(wantedList, messages, setNum,
                                                        wish.condition ?: Condition.NEW, wish.owner))
                }
                cancelBarcode()
                return
            }
            ScannerOrigin.PART_LIST -> {
                _barcodeState.update { withoutResult(it).copy(forPartList = setNum) }
                return
            }
            ScannerOrigin.GALLERY, ScannerOrigin.GALLERY_SEARCH, ScannerOrigin.GALLERY_FILTER -> Unit
        }
        _barcodeState.update { withoutResult(it).copy(add = Operation.Running) }
        viewModelScope.launch {
            when (val r = sets.addSet(setNum, wish.quantity.coerceAtLeast(1), wish.purchasePrice, wish.condition,
                                      wish.owner, wish.storageLocation?.trim()?.takeIf { it.isNotEmpty() })) {
                is Outcome.Success -> {
                    // Saved offline: the outbox reporter gives the notice, with a count.
                    if (!r.buffered) messages.show(messages.text(
                        if (r.data.catalogOpen) R.string.vm_set_added_no_catalog else R.string.vm_set_added,
                        if (r.data.catalogOpen) setNum else r.data.name ?: setNum))
                    if (!r.buffered) supplementStore(r.data)
                }
                is Outcome.Failure -> reportFailedEntry(setNum, messages.message(r))
            }
            _barcodeState.update { it.copy(add = Operation.Done) }
        }
    }

    override fun cancelBarcode() {
        _barcodeState.update { withoutResult(it) }
    }

    private fun withoutResult(b: BarcodeUiState) = b.copy(
        result = null, setName = null, imageUrl = null, imageLocal = null, year = null,
        pieces = null, theme = null, minifigs = null, add = Operation.Done, unsafe = false, ownershipQuantity = 0)

    /** Open manual entry, without a scan having happened first (camera not permitted). */
    fun manualRecord(origin: ScannerOrigin) {
        _barcodeState.update { it.copy(source = origin, requestManualEntry = true) }
    }

    fun acknowledgeManualEntry() {
        _barcodeState.update { it.copy(requestManualEntry = false) }
    }

    /** The parts list has taken over the scanned set number. */
    fun clearBarcodeForPartsList() {
        _barcodeState.update { it.copy(forPartList = null) }
    }

    /**
     * Add a set by its set number (gallery, catalog).
     *
     * Whether it is already in view is answered by the server in the call itself
     * (`action = "exists"`, without writing); the check display shows the
     * steps of the event stream and disappears with the answer, not only
     * after the reload.
     */
    fun addSet(wish: EntryRequest) {
        viewModelScope.launch {
            val input = wish.setNumber.trim()
            val storageLocation = wish.storageLocation?.trim()?.takeIf { it.isNotEmpty() }
            // Only for display, reduced to the base variant; it is created with the entered value.
            val sn = if (input.contains("-")) input else "$input-1"
            val streamed = try {
                entryVm.show(sn, CheckPhase.STOCK)
                var last: Outcome<SetRecorded> = Outcome.Failure.EmptyResponse()
                creator.create(input, wish.quantity, wish.purchasePrice, wish.condition, wish.owner, storageLocation)
                    .collect { step ->
                        when (step) {
                            is SetCreateStep.MasterData -> entryVm.show(step.name ?: sn, CheckPhase.CREATE_MASTER_DATA)
                            SetCreateStep.Image -> entryVm.show(sn, CheckPhase.CREATE_IMAGE)
                            SetCreateStep.FastDone -> entryVm.show(sn, CheckPhase.CREATE_COMPLETION)
                            is SetCreateStep.Done -> last = Outcome.Success(step.outcome)
                            SetCreateStep.NoConnection -> last = Outcome.Failure.Network()
                            is SetCreateStep.Failure -> last =
                                if (step.message.isBlank()) Outcome.Failure.Cancelled
                                else Outcome.Failure.Refusal(step.message)
                        }
                    }
                last
            } finally {
                entryVm.done()
            }
            // Without a connection there is no event stream: then the ordinary call, which
            // goes into the outbox, instead of letting the add fail.
            val r = if (streamed is Outcome.Failure && streamed.transient)
                sets.addSet(input, wish.quantity, wish.purchasePrice, wish.condition, wish.owner, storageLocation)
            else streamed
            when (r) {
                is Outcome.Success -> when {
                    r.buffered -> Unit
                    r.data.present -> _barcodeState.update { it.copy(foundSet = r.data.number ?: sn) }
                    else -> {
                        messages.show(messages.text(when {
                            r.data.catalogOpen -> R.string.vm_set_added_no_catalog
                            r.data.created -> R.string.vm_added
                            else -> R.string.vm_updated
                        }, if (r.data.catalogOpen) r.data.number else r.data.name ?: r.data.number))
                        supplementStore(r.data)
                    }
                }
                is Outcome.Failure -> reportFailedEntry(sn, messages.message(r))
            }
        }
    }

    /**
     * In the store the set already has its number and quantity; name, image and prices
     * are known only to the server. If a sync is still pending there, fetch only after it.
     */
    private fun supplementStore(response: SetRecorded) {
        viewModelScope.launch {
            if (response.supplementPending) delay(SUPPLEMENT_AFTER_MS)
            sets.refreshSets()
        }
    }

    /** A failure while adding names the set number and the reason — otherwise all one sees is that nothing happened. */
    private fun reportFailedEntry(setNumber: String, reason: String?) {
        messages.show(messages.text(R.string.vm_add_failed, setNumber, reason ?: messages.text(R.string.pdfexp_unknown_error)))
    }

    /** The cancel button of the check display: a running scan is aborted, the display cleared. */
    override fun cancelCheck() {
        entryJob?.cancel()
        entryJob = null
        entryVm.done()
    }

    private fun reset() {
        cancelCheck()
        _barcodeState.value = BarcodeUiState()
    }
}

/** The job starts right away, in the event stream after one minute. */
private const val SUPPLEMENT_AFTER_MS = 70_000L
