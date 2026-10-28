package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.model.ApiLimits
import ch.brickinventoryapp.data.model.BricksetQueueEntry
import ch.brickinventoryapp.data.model.CacheStatsResponse
import ch.brickinventoryapp.data.model.JobStatus
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.VerwaltungUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

/**
 * Was der Monitoring-Bildschirm vom Server weiss — nur Serverdaten. Was gerade
 * bearbeitet wird (aufgeklappt, halb getippte Zahl), bleibt im Composable in
 * `rememberSaveable`.
 */
data class MonitoringUiState(
    val jobs: Map<String, JobStatus> = emptyMap(),
    /**
     * Zeitplan je Job, mit derselben Antwort wie `jobs` (`schedules`): damit die App
     * zeigt, wann ein Job das nächste Mal läuft, und es ändern kann.
     */
    val jobSchedules: Map<String, ch.brickinventoryapp.data.model.JobSchedule> = emptyMap(),
    val queue: List<BricksetQueueEntry> = emptyList(),
    val queueLoading: Boolean = false,
    val aktualisiert: Boolean = false,
    val cacheStats: CacheStatsResponse? = null,
    val apiLimits: ApiLimits? = null,
    val cacheTtl: String = "24",
    val vorgabeZustand: String = "N",
)

/**
 * Der Monitoring-Bildschirm holt seine Daten über dieses ViewModel statt aus den
 * Composables, damit die Ladelogik ohne Compose-Laufzeit prüfbar ist. Ein eigenes
 * ViewModel am NavHost-Ziel (hiltViewModel()), weil der selten geöffnete
 * Bildschirm mit seiner Abfrageschleife nicht die Lebensdauer der Activity
 * braucht.
 *
 *   hierher      was vom Server kommt — wird ohnehin neu geladen
 *   Bildschirm   was der Mensch angefasst hat (rememberSaveable)
 *   Bildschirm   Knopftexte eines laufenden Vorgangs — dürfen eine Drehung nicht überleben
 *
 * Keine Texte hier: Die Funktionen sagen, was passiert ist; den Satz wählt die
 * Anzeige, wie in FehlerTexte.kt.
 */
@HiltViewModel
class MonitoringViewModel @Inject constructor(
    private val repo: BrickRepository,
    private val texte: Texte,
) : ViewModel() {

    private val _state = MutableStateFlow(MonitoringUiState())
    val state = _state.asStateFlow()

    /** Das Server-Protokoll — eigener Fluss, es lädt nur auf Wunsch. */
    private val _verwaltungState = MutableStateFlow(VerwaltungUiState())
    val verwaltungState = _verwaltungState.asStateFlow()

    suspend fun ladeProtokoll(minuten: Int = _verwaltungState.value.protokollMinuten) {
        _verwaltungState.update { it.copy(protokollLaden = true, protokollMinuten = minuten, fehler = null) }
        when (val r = repo.admin.getProtokoll(minuten)) {
            is Result.Success -> _verwaltungState.update {
                it.copy(protokollLaden = false, protokoll = r.data.logs,
                        fehler = if (r.data.success) null else r.data.error)
            }
            is Result.Error -> _verwaltungState.update { it.copy(protokollLaden = false, fehler = texte.meldung(r)) }
        }
    }

    suspend fun ladeJobs() {
        _state.update { it.copy(aktualisiert = true) }
        val r = repo.admin.getJobs()
        _state.update {
            if (r is Result.Success)
                it.copy(jobs = r.data.jobs, jobSchedules = r.data.schedules, aktualisiert = false)
            else it.copy(aktualisiert = false)
        }
    }

    suspend fun ladeWarteschlange() {
        _state.update { it.copy(queueLoading = true) }
        val r = repo.admin.getBricksetQueue()
        _state.update {
            if (r is Result.Success) it.copy(queue = r.data.entries, queueLoading = false)
            else it.copy(queueLoading = false)
        }
    }

    /** Wiederholt einen hängengebliebenen Eintrag; lädt die Liste danach neu. */
    suspend fun wiederholeEintrag(setNummer: String): Boolean {
        val ok = repo.admin.retryBricksetEntry(setNummer) is Result.Success
        if (ok) ladeWarteschlange()
        return ok
    }

    /**
     * Entfernt einen Eintrag, in der Anzeige vorweggenommen. Scheitert der Server,
     * wird neu geladen statt die alte Kopie zurückgeschrieben — dazwischen kann sich
     * am Server anderes geändert haben.
     */
    suspend fun entferneEintrag(setNummer: String): Boolean {
        _state.update { it.copy(queue = it.queue.filter { e -> e.setNumber != setNummer }) }
        val ok = repo.admin.deleteBricksetEntry(setNummer) is Result.Success
        if (!ok) ladeWarteschlange()
        return ok
    }

    /** Anleitungen neu einlesen; zurück kommt die Zahl der eingereihten Sets, sonst null. */
    suspend fun leseAnleitungenNeuEin(): Int? =
        (repo.sets.reimportInstructions() as? Result.Success)?.data?.enqueued

    suspend fun starteCsvAbgleich(): Boolean = repo.sets.triggerCsvSync() is Result.Success

    suspend fun startePreislauf(): Boolean = repo.finanzen.triggerPriceJob() is Result.Success

    suspend fun ladeFehlendeBilderNach(): Boolean =
        repo.admin.redownloadMissingImages() is Result.Success

    /**
     * Cache-Zahlen, API-Grenzwerte, Cache-Dauer und Vorgabe-Zustand in einem Zug —
     * nacheinander, weil es parallel nicht sichtbar schneller wäre, die Reihenfolge
     * der Zustandsänderungen aber unbestimmt.
     */
    suspend fun ladeCacheUndGrenzen() {
        (repo.admin.getCacheStats() as? Result.Success)?.let { r ->
            _state.update { it.copy(cacheStats = r.data) }
        }
        (repo.admin.getApiLimits() as? Result.Success)?.let { r ->
            _state.update { it.copy(apiLimits = r.data.limits) }
        }
        (repo.admin.getCacheTtl() as? Result.Success)?.let { r ->
            _state.update { it.copy(cacheTtl = r.data.ttl) }
        }
        (repo.teile.getDefaultCondition() as? Result.Success)?.let { r ->
            _state.update { it.copy(vorgabeZustand = r.data.condition) }
        }
    }

    suspend fun setzeCacheDauer(stunden: Int): Boolean {
        val ok = repo.admin.setCacheTtl(stunden) is Result.Success
        if (ok) _state.update { it.copy(cacheTtl = stunden.toString()) }
        return ok
    }

    /**
     * Cache leeren und die Zahlen sofort neu holen — sonst stünden die alten da, und
     * nichts zeigte, dass etwas passiert ist.
     */
    suspend fun leereCache(alles: Boolean): Boolean {
        val ok = repo.admin.clearCache(alles) is Result.Success
        if (ok) ladeCacheUndGrenzen()
        return ok
    }

    /**
     * Zeitplan eines Jobs setzen und neu holen, weil der Server normalisiert („7:5“ →
     * „07:05“, mindestens fünf Minuten): Es soll dastehen, was gilt.
     */
    suspend fun setzeJobZeitplan(name: String, zeit: String? = null, minuten: Int? = null): Boolean {
        val ok = repo.admin.setJobSchedule(name, zeit, minuten) is Result.Success
        if (ok) ladeJobs()
        return ok
    }

    /** Fehlende KATALOGbilder einreihen — nicht die des Bestands daneben. */
    suspend fun reiheKatalogbilderEin(): Boolean =
        repo.admin.queueCatalogImages() is Result.Success

    /**
     * Das globale Design umstellen. `loadSettings()` beim Aufrufer zieht den neuen
     * Wert in den Zustand und merkt ihn, damit die Anzeige sofort wechselt und den
     * Kaltstart überlebt.
     */
    suspend fun setzeDesign(theme: String): Boolean =
        repo.admin.setAppTheme(theme) is Result.Success

    suspend fun setzeGrenzwerte(rebrickable: Int, bricklink: Int, brickset: Int): Boolean {
        val ok = repo.admin.setApiLimits(rebrickable, bricklink, brickset) is Result.Success
        if (ok) {
            (repo.admin.getApiLimits() as? Result.Success)?.let { r ->
                _state.update { it.copy(apiLimits = r.data.limits) }
            }
        }
        return ok
    }

    /**
     * Vorgabe-Zustand (neu/gebraucht) setzen, in der Anzeige vorweggenommen; scheitert
     * der Aufruf, wird zurückgestellt, sonst behauptete die Oberfläche etwas, das nie
     * gespeichert wurde.
     */
    suspend fun setzeVorgabeZustand(zustand: String): Boolean {
        val vorher = _state.value.vorgabeZustand
        _state.update { it.copy(vorgabeZustand = zustand) }
        val ok = repo.teile.setDefaultCondition(zustand) is Result.Success
        if (!ok) _state.update { it.copy(vorgabeZustand = vorher) }
        return ok
    }
}
