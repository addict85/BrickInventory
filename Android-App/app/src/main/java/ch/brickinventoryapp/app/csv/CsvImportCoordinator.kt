package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.local.StockReconciliation
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.services.service.CsvImportRunner
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Follows a CSV import and controls its background follow-up (a worker). Separate from the
 * ViewModel because follow-up and stock sync are side effects of the app; the
 * ViewModel only shows [condition]. A singleton so that a new ViewModel after
 * a new activity sees the same bar.
 */
@Singleton
class CsvImportCoordinator @Inject constructor(
    private val csvImport: CsvImportRepository,
    private val service: CsvImportRunner,
    private val sync: StockReconciliation,
) {
    private val _uiState = MutableStateFlow(CsvImportUiState())
    val uiState: StateFlow<CsvImportUiState> = _uiState.asStateFlow()
    private val follows = AtomicBoolean(false)

    /**
     * Follows the stream as long as [loggedIn] reports true, and ends with the caller.
     * Signed out the bar is empty and the connection closed; a running follow-up stops.
     * If someone already follows, the call returns immediately: one connection, one bar.
     */
    suspend fun sequence(loggedIn: Flow<Boolean>) {
        if (!follows.compareAndSet(false, true)) return
        try {
            loggedIn.distinctUntilChanged().collectLatest { an ->
                if (!an && _uiState.value.jobRun.running) service.stop()
                _uiState.value = CsvImportUiState()
                if (an) csvImport.observe().collect { process(it) }
            }
        } finally {
            follows.set(false)
        }
    }

    private suspend fun process(s: CsvImportStatusView) {
        // Decide before overwriting — afterwards “before” would already be the new state.
        val sequence = csvSequence(wasBeforeActive = _uiState.value.jobRun.running, status = s.status)
        if (sequence == CsvSequence.SERVICE_START) service.start()
        _uiState.value = CsvImportUiState(
            jobRun = if (importRunning(s.status)) Operation.Running else Operation.Done,
            done = s.done,
            total = s.total,
            current = s.current,
            ok = s.ok,
            warn = s.warn,
            err = s.err,
        )
        when (sequence) {
            CsvSequence.RELOAD -> {
                sync.stock()
                tidyUp()
            }
            CsvSequence.ERROR_CLEAN_UP -> tidyUp()
            CsvSequence.SERVICE_START, CsvSequence.NOTHING -> {}
        }
    }

    /** The bar stays briefly so that the result can be read. */
    private suspend fun tidyUp() {
        delay(BAR_VISIBLE_MS)
        _uiState.value = CsvImportUiState()
        service.stop()
    }

    private companion object {
        const val BAR_VISIBLE_MS = 5_000L
    }
}
