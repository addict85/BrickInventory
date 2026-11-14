package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.dienste.service.CsvImportDienst
import ch.brickinventoryapp.model.ui.model.CsvImportStandAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
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
class CsvImportKoordinator @Inject constructor(
    private val csvImport: CsvImportRepository,
    private val dienst: CsvImportDienst,
    private val abgleich: Bestandsabgleich,
) {
    private val _zustand = MutableStateFlow(CsvImportUiState())
    val zustand: StateFlow<CsvImportUiState> = _zustand.asStateFlow()
    private val folgt = AtomicBoolean(false)

    /**
     * Folgt dem Strom, solange [angemeldet] true meldet, und endet mit dem Aufrufer.
     * Abgemeldet ist der Balken leer und die Verbindung zu; ein laufender Dienst hält an.
     * Folgt schon jemand, kehrt der Aufruf sofort zurück: eine Verbindung, ein Balken.
     */
    suspend fun folge(angemeldet: Flow<Boolean>) {
        if (!folgt.compareAndSet(false, true)) return
        try {
            angemeldet.distinctUntilChanged().collectLatest { an ->
                if (!an && _zustand.value.running) dienst.stop()
                _zustand.value = CsvImportUiState()
                if (an) csvImport.beobachte().collect { verarbeite(it.alsAnsicht()) }
            }
        } finally {
            folgt.set(false)
        }
    }

    private suspend fun verarbeite(s: CsvImportStandAnsicht) {
        // Vor dem Überschreiben entscheiden — danach wäre „vorher“ schon der neue Zustand.
        val folge = csvFolge(warVorherAktiv = _zustand.value.running, status = s.status)
        if (folge == CsvFolge.DIENST_STARTEN) dienst.start()
        _zustand.value = CsvImportUiState(
            running = importLaeuft(s.status),
            done = s.done,
            total = s.total,
            current = s.current,
            ok = s.ok,
            warn = s.warn,
            err = s.err,
        )
        when (folge) {
            CsvFolge.NACHLADEN -> {
                abgleich.bestand()
                raeumeAb()
            }
            CsvFolge.FEHLER_AUFRAEUMEN -> raeumeAb()
            CsvFolge.DIENST_STARTEN, CsvFolge.NICHTS -> {}
        }
    }

    /** Der Balken bleibt kurz stehen, damit man das Ergebnis lesen kann. */
    private suspend fun raeumeAb() {
        delay(BALKEN_STEHT_MS)
        _zustand.value = CsvImportUiState()
        dienst.stop()
    }

    private companion object {
        const val BALKEN_STEHT_MS = 5_000L
    }
}
