package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.services.service.CsvImportDienst
import ch.brickinventoryapp.model.domain.CsvImportStatusView
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
 * Follows a CSV import and controls the foreground service for it. Separate from the
 * ViewModel because service and stock sync are side effects of the app; the
 * ViewModel only shows [zustand]. A singleton so that a new ViewModel after
 * a new activity sees the same bar.
 */
@Singleton
class CsvImportCoordinator @Inject constructor(
    private val csvImport: CsvImportRepository,
    private val dienst: CsvImportDienst,
    private val sync: Bestandsabgleich,
) {
    private val _zustand = MutableStateFlow(CsvImportUiState())
    val zustand: StateFlow<CsvImportUiState> = _zustand.asStateFlow()
    private val folgt = AtomicBoolean(false)

    /**
     * Follows the stream as long as [angemeldet] reports true, and ends with the caller.
     * Signed out the bar is empty and the connection closed; a running service stops.
     * If someone already follows, the call returns immediately: one connection, one bar.
     */
    suspend fun sequence(angemeldet: Flow<Boolean>) {
        if (!folgt.compareAndSet(false, true)) return
        try {
            angemeldet.distinctUntilChanged().collectLatest { an ->
                if (!an && _zustand.value.lauf.laeuft) dienst.stop()
                _zustand.value = CsvImportUiState()
                if (an) csvImport.observe().collect { process(it) }
            }
        } finally {
            folgt.set(false)
        }
    }

    private suspend fun process(s: CsvImportStatusView) {
        // Decide before overwriting — afterwards “before” would already be the new state.
        val sequence = csvSequence(warBeforeActive = _zustand.value.lauf.laeuft, status = s.status)
        if (sequence == CsvSequence.DIENST_STARTEN) dienst.start()
        _zustand.value = CsvImportUiState(
            lauf = if (importRunning(s.status)) Vorgang.Laeuft else Vorgang.Fertig,
            done = s.done,
            total = s.total,
            current = s.current,
            ok = s.ok,
            warn = s.warn,
            err = s.err,
        )
        when (sequence) {
            CsvSequence.NACHLADEN -> {
                sync.bestand()
                cleanAb()
            }
            CsvSequence.FEHLER_AUFRAEUMEN -> cleanAb()
            CsvSequence.DIENST_STARTEN, CsvSequence.NICHTS -> {}
        }
    }

    /** The bar stays briefly so that the result can be read. */
    private suspend fun cleanAb() {
        delay(BAR_STANDS_MS)
        _zustand.value = CsvImportUiState()
        dienst.stop()
    }

    private companion object {
        const val BAR_STANDS_MS = 5_000L
    }
}
