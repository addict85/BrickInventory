package ch.brickinventoryapp.management.ui.viewmodel

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.ManagementRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.model.domain.ApiLimitsView
import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.CacheMetricsView
import ch.brickinventoryapp.model.domain.JobStateView
import ch.brickinventoryapp.model.domain.ScheduleView
import ch.brickinventoryapp.resources.R
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.model.domain.Fehlercode
import ch.brickinventoryapp.model.domain.BackgroundView
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.dataOrNull
import ch.brickinventoryapp.state.ui.loadAs
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn

/**
 * Was der Monitoring-Bildschirm vom Server weiss — nur Serverdaten. Was gerade
 * bearbeitet wird (aufgeklappt, halb getippte Zahl), bleibt im Composable in
 * `rememberSaveable`.
 */
data class MonitoringUiState(
    val jobs: Map<String, JobStateView> = emptyMap(),
    /**
     * Zeitplan je Job, mit derselben Antwort wie `jobs` (`schedules`): damit die App
     * zeigt, wann ein Job das nächste Mal läuft, und es ändern kann.
     */
    val jobSchedules: Map<String, ScheduleView> = emptyMap(),
    val queue: Laden<List<BricksetEntryView>> = Laden.Daten(emptyList()),
    /** Was ein laufender oder eben gestarteter Knopf statt seiner Beschriftung zeigt. */
    val buttons: Map<Jobstart, Meldung> = emptyMap(),
    val aktualisiert: Boolean = false,
    val cacheStats: CacheMetricsView? = null,
    val apiLimits: ApiLimitsView? = null,
    val cacheTtl: String = "24",
    val defaultState: Zustand = Zustand.NEU,
    /** Das Design, das der Verwalter allen vorgibt — nicht das eigene des Kontos. */
    val defaultDesign: Design? = null,
    /** Der Server sagte `nur_admins`: Die Abfrageschleife hört auf, statt alle 5 s erneut abgewiesen zu werden. */
    val accessRevoked: Boolean = false,
)

private fun entzogen(r: Ergebnis<*>) = r is Ergebnis.Fehler && r.code == Fehlercode.NUR_ADMINS

/** Die Hintergrundarbeiten (Auftragstabelle); die Ansicht bleibt stehen, während neu geholt wird. */
data class BackgroundUiState(
    val ansicht: BackgroundView? = null,
    val abruf: Laden<Unit> = Laden.Daten(Unit),
)

/**
 * Der Monitoring-Bildschirm holt seine Daten über dieses ViewModel statt aus den Composables,
 * damit die Ladelogik ohne Compose-Laufzeit prüfbar ist.
 */
@HiltViewModel
class MonitoringViewModel @Inject constructor(
    private val verwaltung: ManagementRepository,
    private val konto: AccountRepository,
    private val meldungen: MeldungsKanal,
) : ViewModel(), MonitoringActions {

    private val _state = MutableStateFlow(MonitoringUiState())
    val state = _state.asStateFlow()

    init {
        observeLoadOn(_state) { viewModelScope.launch { loadCacheAndLimits(); loadDesignDefault() } }
    }

    /** Das Server-Protokoll — eigener Fluss, es lädt nur auf Wunsch. */
    private val _managementState = MutableStateFlow(ManagementUiState())
    val managementState = _managementState.asStateFlow()

    internal suspend fun loadLog(minuten: Int) {
        _managementState.update { it.copy(abruf = Laden.Loads, logMinutes = minuten) }
        when (val r = verwaltung.getLog(minuten)) {
            is Ergebnis.Erfolg -> _managementState.update { it.copy(protokoll = r.data, abruf = Laden.Daten(Unit)) }
            is Ergebnis.Fehler -> _managementState.update { it.copy(abruf = loadError(r)) }
        }
    }

    override fun chooseLog(minuten: Int) {
        viewModelScope.launch { loadLog(minuten) }
    }

    private val _background = MutableStateFlow(BackgroundUiState())
    val hintergrund = _background.asStateFlow()

    /**
     * Hält Aufträge und Hintergrundarbeiten aktuell, bis der Aufrufer endet (die Seite
     * ist nicht mehr zu sehen) oder der Server das Verwalterrecht verneint; dann
     * fragte jeder weitere Takt nur noch ein 403 ab.
     */
    suspend fun haltAktuell() {
        while (!_state.value.accessRevoked) {
            loadJobs()
            loadBackground()
            delay(TICK_MS)
        }
    }

    suspend fun loadBackground() {
        _background.update { it.copy(abruf = Laden.Loads) }
        when (val r = verwaltung.getAuftraege()) {
            is Ergebnis.Erfolg -> _background.update { BackgroundUiState(ansicht = r.data) }
            is Ergebnis.Fehler -> {
                _background.update { it.copy(abruf = loadError(r)) }
                if (entzogen(r)) _state.update { it.copy(accessRevoked = true) }
            }
        }
    }

    /**
     * Abbrechen, wiederholen, starten, leeren: Das Ergebnis ist die Meldung — bei 409
     * der Satz des Servers, denn nur er weiss, warum der Auftrag
     * inzwischen nicht mehr passt. Danach wird die Liste neu geholt, so oder so.
     */
    internal suspend fun abortJobAb(id: String): Meldung =
        afterJob(verwaltung.abortJobAb(id)) { Meldung.Resource(R.string.hintergrund_abgebrochen_ok) }

    internal suspend fun repeatJob(id: String): Meldung =
        afterJob(verwaltung.repeatJob(id)) { Meldung.Resource(R.string.hintergrund_wiederholt_ok) }

    internal suspend fun starteAuftragsArt(art: String, name: String): Meldung =
        afterJob(verwaltung.starteAuftragsArt(art)) {
            Meldung.Resource(if (it) R.string.hintergrund_gestartet else R.string.hintergrund_nichts_gestartet, listOf(name))
        }

    internal suspend fun emptyJobKind(art: String): Meldung =
        afterJob(verwaltung.emptyJobKind(art)) { Meldung.Menge(R.plurals.hintergrund_geleert, it) }

    // Im viewModelScope, nicht im Scope des Bildschirms: Wer die Seite verlässt,
    // bricht die Aktion nicht ab, und der Satz geht nicht am Zustand vorbei.
    override fun cancelJob(id: String) = melde { abortJobAb(id) }
    override fun retryJob(id: String) = melde { repeatJob(id) }
    override fun auftragsArtStarten(art: String, name: String) = melde { starteAuftragsArt(art, name) }
    override fun clearJobKind(art: String) = melde { emptyJobKind(art) }

    private val _settingsNew = MutableStateFlow(false)

    /** Design oder Vorgabe-Zustand geändert: Die App lädt ihre Einstellungen nach und quittiert. */
    val settingsNew = _settingsNew.asStateFlow()

    fun einstellungenGeladen() {
        _settingsNew.value = false
    }

    fun defaultStateChoose(zustand: Zustand) = gespeichert(einstellungen = true) { setDefaultState(zustand) }
    fun designChoose(theme: Design) = gespeichert(einstellungen = true) { setzeDesign(theme) }
    fun saveCacheDuration(hours: Int) = gespeichert { setCacheDuration(hours) }
    fun cacheLeeren(alles: Boolean) = gespeichert(R.string.monitoring_cache_cleared) { emptyCache(alles) }
    fun saveLimits(rebrickable: Int, bricklink: Int, brickset: Int) =
        gespeichert(R.string.monitoring_limits_saved) { setLimits(rebrickable, bricklink, brickset) }

    // Nur ein Erfolg meldet sich; ein Fehlschlag lässt den angezeigten Stand stehen.
    private fun gespeichert(satz: Int = R.string.monitoring_cache_saved, einstellungen: Boolean = false, aktion: suspend () -> Boolean) {
        viewModelScope.launch {
            if (!aktion()) return@launch
            if (einstellungen) _settingsNew.value = true
            meldungen.zeige(Meldung.Resource(satz))
        }
    }

    private fun melde(aktion: suspend () -> Meldung) {
        viewModelScope.launch { meldungen.zeige(aktion()) }
    }

    private suspend fun <T> afterJob(r: Ergebnis<T>, erfolg: (T) -> Meldung): Meldung {
        val satz = when (r) {
            is Ergebnis.Erfolg -> erfolg(r.data)
            is Ergebnis.Fehler -> errorMessage(r)
        }
        loadBackground()
        return satz
    }

    override fun refresh() {
        viewModelScope.launch { loadJobs() }
    }

    internal suspend fun loadJobs() {
        _state.update { it.copy(aktualisiert = true) }
        val r = verwaltung.getJobs()
        _state.update {
            if (r is Ergebnis.Erfolg)
                it.copy(jobs = r.data.jobs, jobSchedules = r.data.schedules, aktualisiert = false)
            else it.copy(aktualisiert = false, accessRevoked = it.accessRevoked || entzogen(r))
        }
    }

    override fun showQueue() {
        viewModelScope.launch { loadQueue() }
    }

    internal suspend fun loadQueue() {
        _state.update { it.copy(queue = Laden.Loads) }
        val r = verwaltung.getBricksetQueue()
        _state.update { it.copy(queue = r.loadAs()) }
    }

    override fun wiederhole(setNummer: String) = reportAfter(
        { repeatEntry(setNummer) },
        Meldung.Resource(R.string.monitoring_retry_queued, listOf(setNummer)),
        Meldung.Resource(R.string.monitoring_retry_error),
    )

    override fun entferne(setNummer: String) = reportAfter(
        { removeEntry(setNummer) },
        Meldung.Resource(R.string.monitoring_entry_removed, listOf(setNummer)),
        Meldung.Resource(R.string.monitoring_delete_error),
    )

    private fun reportAfter(aktion: suspend () -> Boolean, erfolg: Meldung, failure: Meldung) {
        viewModelScope.launch { meldungen.zeige(if (aktion()) erfolg else failure) }
    }

    /** Wiederholt einen hängengebliebenen Eintrag; lädt die Liste danach neu. */
    internal suspend fun repeatEntry(setNummer: String): Boolean {
        val ok = verwaltung.retryBricksetEntry(setNummer) is Ergebnis.Erfolg
        if (ok) loadQueue()
        return ok
    }

    /**
     * Entfernt einen Eintrag, in der Anzeige vorweggenommen. Scheitert der Server,
     * wird neu geladen statt die alte Kopie zurückgeschrieben — dazwischen kann sich
     * am Server anderes geändert haben.
     */
    internal suspend fun removeEntry(setNummer: String): Boolean {
        _state.update { s ->
            val ohne = s.queue.dataOrNull()?.filter { it.setNumber != setNummer }
            if (ohne == null) s else s.copy(queue = Laden.Daten(ohne))
        }
        val ok = verwaltung.deleteBricksetEntry(setNummer) is Ergebnis.Erfolg
        if (!ok) loadQueue()
        return ok
    }

    /**
     * Ein Startknopf zeigt „startet…“, nach Erfolg vier Sekunden lang, was geschah, dann
     * wieder seine Beschriftung; ein Fehlschlag geht als Meldung in die Snackbar. Gesperrt
     * wird vor dem launch, sonst startete ein Doppeltipp zweimal.
     */
    override fun starte(job: Jobstart) {
        if (job in _state.value.buttons) return
        setButton(job, Meldung.Resource(if (job == Jobstart.INSTRUCTIONS) R.string.common_loading else R.string.monitoring_starting))
        viewModelScope.launch {
            val gestartet = startJob(job)
            if (gestartet == null) {
                setButton(job, null)
                val satz = if (job == Jobstart.INSTRUCTIONS) R.string.monitoring_reimport_error else R.string.monitoring_start_error
                meldungen.zeige(Meldung.Resource(satz))
                return@launch
            }
            setButton(job, gestartet)
            delay(STARTED_MS)
            setButton(job, null)
        }
    }

    private fun setButton(job: Jobstart, stand: Meldung?) =
        _state.update { it.copy(buttons = if (stand == null) it.buttons - job else it.buttons + (job to stand)) }

    /** Startet den Job; zurück kommt, was der Knopf danach zeigt, oder null bei einem Fehlschlag. */
    internal suspend fun startJob(job: Jobstart): Meldung? {
        val gestartet = Meldung.Resource(R.string.monitoring_started)
        return when (job) {
            Jobstart.CSV_ABGLEICH -> Meldung.Resource(R.string.monitoring_sync_started_short)
                .takeIf { verwaltung.triggerCsvSync() is Ergebnis.Erfolg }
            Jobstart.PREISLAUF -> gestartet.takeIf { verwaltung.triggerPriceJob() is Ergebnis.Erfolg }
            Jobstart.BESTANDSBILDER -> gestartet.takeIf { verwaltung.redownloadMissingImages() is Ergebnis.Erfolg }
            // Die Bilder des Katalogs, nicht die des Bestands daneben.
            Jobstart.KATALOGBILDER -> gestartet.takeIf { verwaltung.queueCatalogImages() is Ergebnis.Erfolg }
            Jobstart.INSTRUCTIONS -> (verwaltung.reimportInstructions() as? Ergebnis.Erfolg)?.data
                ?.let { Meldung.Menge(R.plurals.monitoring_reimport_enqueued, it) }
        }
    }

    /**
     * Cache-Zahlen, API-Grenzwerte, Cache-Dauer und Vorgabe-Zustand in einem Zug —
     * nacheinander, weil es parallel nicht sichtbar schneller wäre, die Reihenfolge
     * der Zustandsänderungen aber unbestimmt.
     */
    internal suspend fun loadCacheAndLimits() {
        (verwaltung.getCacheStats() as? Ergebnis.Erfolg)?.let { r ->
            _state.update { it.copy(cacheStats = r.data) }
        }
        (verwaltung.getApiLimits() as? Ergebnis.Erfolg)?.let { r ->
            _state.update { it.copy(apiLimits = r.data) }
        }
        (verwaltung.getCacheTtl() as? Ergebnis.Erfolg)?.let { r ->
            _state.update { it.copy(cacheTtl = r.data) }
        }
        (konto.getDefaultCondition() as? Ergebnis.Erfolg)?.let { r ->
            _state.update { it.copy(defaultState = r.data) }
        }
    }

    internal suspend fun setCacheDuration(hours: Int): Boolean {
        val ok = verwaltung.setCacheTtl(hours) is Ergebnis.Erfolg
        if (ok) _state.update { it.copy(cacheTtl = hours.toString()) }
        return ok
    }

    /**
     * Cache leeren und die Zahlen sofort neu holen — sonst stünden die alten da, und
     * nichts zeigte, dass etwas passiert ist.
     */
    internal suspend fun emptyCache(alles: Boolean): Boolean {
        val ok = verwaltung.clearCache(alles) is Ergebnis.Erfolg
        if (ok) loadCacheAndLimits()
        return ok
    }

    /**
     * Zeitplan eines Jobs setzen und neu holen, weil der Server normalisiert („7:5“ →
     * „07:05“, mindestens fünf Minuten): Es soll dastehen, was gilt.
     */
    override fun setSchedule(name: String, zeit: String?, minuten: Int?) {
        viewModelScope.launch {
            if (setzeJobZeitplan(name, zeit, minuten)) meldungen.zeige(Meldung.Resource(R.string.monitoring_cache_saved))
        }
    }

    internal suspend fun setzeJobZeitplan(name: String, zeit: String? = null, minuten: Int? = null): Boolean {
        val ok = verwaltung.setJobSchedule(name, zeit, minuten) is Ergebnis.Erfolg
        if (ok) loadJobs()
        return ok
    }

    /**
     * Die Vorgabe aus /settings/theme. Ein älterer Server kennt `vorgabe` noch
     * nicht; dort war das wirksame Design zugleich die Vorgabe.
     */
    internal suspend fun loadDesignDefault() {
        (konto.getAppTheme() as? Ergebnis.Erfolg)?.let { r ->
            _state.update { it.copy(defaultDesign = r.data.vorgabe ?: r.data.wirksam) }
        }
    }

    /**
     * Das globale Design umstellen. `loadSettings()` beim Aufrufer zieht den neuen
     * Wert in den Zustand und merkt ihn, damit die Anzeige sofort wechselt und den
     * Kaltstart überlebt.
     */
    internal suspend fun setzeDesign(theme: Design): Boolean {
        val ok = verwaltung.setAppTheme(theme) is Ergebnis.Erfolg
        if (ok) _state.update { it.copy(defaultDesign = theme) }
        return ok
    }

    internal suspend fun setLimits(rebrickable: Int, bricklink: Int, brickset: Int): Boolean {
        val ok = verwaltung.setApiLimits(rebrickable, bricklink, brickset) is Ergebnis.Erfolg
        if (ok) {
            (verwaltung.getApiLimits() as? Ergebnis.Erfolg)?.let { r ->
                _state.update { it.copy(apiLimits = r.data) }
            }
        }
        return ok
    }

    /**
     * Vorgabe-Zustand (neu/gebraucht) setzen, in der Anzeige vorweggenommen; scheitert
     * der Aufruf, wird zurückgestellt, sonst behauptete die Oberfläche etwas, das nie
     * gespeichert wurde.
     */
    internal suspend fun setDefaultState(zustand: Zustand): Boolean {
        val vorher = _state.value.defaultState
        _state.update { it.copy(defaultState = zustand) }
        val ok = verwaltung.setDefaultCondition(zustand) is Ergebnis.Erfolg
        if (!ok) _state.update { it.copy(defaultState = vorher) }
        return ok
    }
}

/** Abstand der Abfragen, solange das Monitoring zu sehen ist. */
private const val TICK_MS = 5_000L

/** So lange zeigt ein Startknopf, dass er gestartet hat. */
private const val STARTED_MS = 4_000L
