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
 * What the monitoring screen knows from the server — server data only. What is
 * currently being edited (expanded, a half-typed number) stays in the composable, in
 * `rememberSaveable`.
 */
data class MonitoringUiState(
    val jobs: Map<String, JobStateView> = emptyMap(),
    /**
     * Schedule per job, with the same answer as `jobs` (`schedules`): so that the app
     * shows when a job runs next, and can change it.
     */
    val jobSchedules: Map<String, ScheduleView> = emptyMap(),
    val queue: Laden<List<BricksetEntryView>> = Laden.Daten(emptyList()),
    /** What a running or just-started button shows instead of its label. */
    val buttons: Map<Jobstart, Meldung> = emptyMap(),
    val aktualisiert: Boolean = false,
    val cacheStats: CacheMetricsView? = null,
    val apiLimits: ApiLimitsView? = null,
    val cacheTtl: String = "24",
    val defaultState: Zustand = Zustand.NEU,
    /** The theme the admin sets for everyone — not the account's own. */
    val defaultDesign: Design? = null,
    /** The server said `nur_admins`: the poll loop stops instead of being rejected again every 5 s. */
    val accessRevoked: Boolean = false,
)

private fun entzogen(r: Ergebnis<*>) = r is Ergebnis.Fehler && r.code == Fehlercode.NUR_ADMINS

/** The background work (job table); the view stays up while it is being fetched anew. */
data class BackgroundUiState(
    val ansicht: BackgroundView? = null,
    val abruf: Laden<Unit> = Laden.Daten(Unit),
)

/**
 * The monitoring screen fetches its data through this ViewModel instead of from the composables,
 * so that the loading logic can be checked without a Compose runtime.
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

    /** The server log — its own flow, it only loads on request. */
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
     * Keeps jobs and background work current until the caller ends (the page
     * is no longer visible) or the server denies admin rights; otherwise
     * every further tick would just fetch another 403.
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
     * Cancel, retry, start, clear: the result is the message — on a 409
     * the server's sentence, because only it knows why the job
     * no longer fits in the meantime. The list is reloaded afterward, either way.
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

    // In the viewModelScope, not the screen's scope: leaving the page
    // does not abort the action, and the sentence does not bypass the state.
    override fun cancelJob(id: String) = melde { abortJobAb(id) }
    override fun retryJob(id: String) = melde { repeatJob(id) }
    override fun auftragsArtStarten(art: String, name: String) = melde { starteAuftragsArt(art, name) }
    override fun clearJobKind(art: String) = melde { emptyJobKind(art) }

    private val _settingsNew = MutableStateFlow(false)

    /** Theme or default state changed: the app reloads its settings and acknowledges. */
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

    // Only a success reports itself; a failure leaves the shown state as is.
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

    /** Retries a stuck entry; reloads the list afterward. */
    internal suspend fun repeatEntry(setNummer: String): Boolean {
        val ok = verwaltung.retryBricksetEntry(setNummer) is Ergebnis.Erfolg
        if (ok) loadQueue()
        return ok
    }

    /**
     * Removes an entry, anticipated in the display. If the server fails,
     * it reloads instead of writing the old copy back — something else may
     * have changed on the server in between.
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
     * A start button shows "starting…", then for four seconds after success what happened, then
     * its label again; a failure goes into the snackbar as a message. It is disabled
     * before the launch, otherwise a double tap would start it twice.
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

    /** Starts the job; returns what the button shows afterward, or null on a failure. */
    internal suspend fun startJob(job: Jobstart): Meldung? {
        val gestartet = Meldung.Resource(R.string.monitoring_started)
        return when (job) {
            Jobstart.CSV_ABGLEICH -> Meldung.Resource(R.string.monitoring_sync_started_short)
                .takeIf { verwaltung.triggerCsvSync() is Ergebnis.Erfolg }
            Jobstart.PREISLAUF -> gestartet.takeIf { verwaltung.triggerPriceJob() is Ergebnis.Erfolg }
            Jobstart.BESTANDSBILDER -> gestartet.takeIf { verwaltung.redownloadMissingImages() is Ergebnis.Erfolg }
            // The catalog's images, not the stock's next to it.
            Jobstart.KATALOGBILDER -> gestartet.takeIf { verwaltung.queueCatalogImages() is Ergebnis.Erfolg }
            Jobstart.INSTRUCTIONS -> (verwaltung.reimportInstructions() as? Ergebnis.Erfolg)?.data
                ?.let { Meldung.Menge(R.plurals.monitoring_reimport_enqueued, it) }
        }
    }

    /**
     * Cache numbers, API limits, cache duration and default state in one
     * go — one after another, because it would not be visibly faster in parallel, while
     * the order of the state changes would become unpredictable.
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
     * Clear the cache and fetch the numbers again right away — otherwise the old
     * ones would stay up, and nothing would show that something happened.
     */
    internal suspend fun emptyCache(alles: Boolean): Boolean {
        val ok = verwaltung.clearCache(alles) is Ergebnis.Erfolg
        if (ok) loadCacheAndLimits()
        return ok
    }

    /**
     * Set a job's schedule and fetch it anew, because the server normalizes it ("7:5" →
     * "07:05", at least five minutes): it should show what applies.
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
     * The default from /settings/theme. An older server does not know `vorgabe`
     * yet; there, the effective theme was also the default.
     */
    internal suspend fun loadDesignDefault() {
        (konto.getAppTheme() as? Ergebnis.Erfolg)?.let { r ->
            _state.update { it.copy(defaultDesign = r.data.vorgabe ?: r.data.wirksam) }
        }
    }

    /**
     * Switch the global theme. `loadSettings()` at the caller pulls the new
     * value into the state and remembers it, so that the display switches right away and
     * survives a cold start.
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
     * Set the default condition (new/used), anticipated in the display; if
     * the call fails, it is rolled back, otherwise the UI would claim something that was never
     * saved.
     */
    internal suspend fun setDefaultState(zustand: Zustand): Boolean {
        val vorher = _state.value.defaultState
        _state.update { it.copy(defaultState = zustand) }
        val ok = verwaltung.setDefaultCondition(zustand) is Ergebnis.Erfolg
        if (!ok) _state.update { it.copy(defaultState = vorher) }
        return ok
    }
}

/** Spacing of the polls, for as long as monitoring is visible. */
private const val TICK_MS = 5_000L

/** For this long, a start button shows that it has started. */
private const val STARTED_MS = 4_000L
