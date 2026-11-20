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
 * Folgt einem CSV-Import und steuert dazu den Vordergrund-Dienst. Getrennt vom
 * ViewModel, weil Dienst und Bestandsabgleich Nebenwirkungen der App sind; das
 * ViewModel zeigt nur [zustand]. Ein Singleton, damit ein neues ViewModel nach
 * einer neuen Activity denselben Balken sieht.
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
     * Folgt dem Strom, solange [angemeldet] true meldet, und endet mit dem Aufrufer.
     * Abgemeldet ist der Balken leer und die Verbindung zu; ein laufender Dienst hält an.
     * Folgt schon jemand, kehrt der Aufruf sofort zurück: eine Verbindung, ein Balken.
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
        // Vor dem Überschreiben entscheiden — danach wäre „vorher“ schon der neue Zustand.
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

    /** Der Balken bleibt kurz stehen, damit man das Ergebnis lesen kann. */
    private suspend fun cleanAb() {
        delay(BAR_STANDS_MS)
        _zustand.value = CsvImportUiState()
        dienst.stop()
    }

    private companion object {
        const val BAR_STANDS_MS = 5_000L
    }
}
