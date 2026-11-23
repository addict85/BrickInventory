package ch.brickinventoryapp.management.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.account.AccountRepository
import ch.brickinventoryapp.data.account.ManagementRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.model.domain.ApiLimitsView
import ch.brickinventoryapp.model.domain.BackgroundView
import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.CacheMetricsView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.model.domain.JobStateView
import ch.brickinventoryapp.model.domain.ScheduleView
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.dataOrNull
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.state.ui.loadAs
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

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
    val queue: Load<List<BricksetEntryView>> = Load.Data(emptyList()),
    /** What a running or just-started button shows instead of its label. */
    val buttons: Map<Jobstart, Message> = emptyMap(),
    val updated: Boolean = false,
    val cacheStats: CacheMetricsView? = null,
    val apiLimits: ApiLimitsView? = null,
    val cacheTtl: String = "24",
    val defaultState: Condition = Condition.NEW,
    /** The theme the admin sets for everyone — not the account's own. */
    val defaultDesign: Design? = null,
    /** Cache numbers, limits, cache duration and defaults: a failure keeps the last values and offers a retry. */
    val settingsFetch: Load<Unit> = Load.Data(Unit),
    /** The server said `only_admins`: the poll loop stops instead of being rejected again every 5 s. */
    val accessRevoked: Boolean = false,
)

private fun revoked(r: Outcome<*>) = r is Outcome.Failure && r.code == ErrorCode.ONLY_ADMINS

/** The background work (job table); the view stays up while it is being fetched anew. */
data class BackgroundUiState(
    val view: BackgroundView? = null,
    val fetch: Load<Unit> = Load.Data(Unit),
)

/**
 * The monitoring screen fetches its data through this ViewModel instead of from the composables,
 * so that the loading logic can be checked without a Compose runtime.
 */
@HiltViewModel
class MonitoringViewModel @Inject constructor(
    private val admin: ManagementRepository,
    private val account: AccountRepository,
    private val messages: MessageChannel,
) : ViewModel(), MonitoringActions {

    private val _state = MutableStateFlow(MonitoringUiState())
    val state = _state.asStateFlow()

    init {
        observeLoadOn(_state) { viewModelScope.launch { loadCacheAndLimits(); loadDesignDefault() } }
    }

    /** The server log — its own flow, it only loads on request. */
    private val _managementState = MutableStateFlow(ManagementUiState())
    val managementState = _managementState.asStateFlow()

    internal suspend fun loadLog(minutes: Int) {
        _managementState.update { it.copy(fetch = Load.Loads, logMinutes = minutes) }
        when (val r = admin.getLog(minutes)) {
            is Outcome.Success -> _managementState.update { it.copy(log = r.data, fetch = Load.Data(Unit)) }
            is Outcome.Failure -> _managementState.update { it.copy(fetch = loadError(r)) }
        }
    }

    override fun chooseLog(minutes: Int) {
        viewModelScope.launch { loadLog(minutes) }
    }

    private val _background = MutableStateFlow(BackgroundUiState())
    val background = _background.asStateFlow()

    /**
     * Keeps jobs and background work current until the caller ends (the page
     * is no longer visible) or the server denies admin rights; otherwise
     * every further tick would just fetch another 403.
     */
    suspend fun holdCurrent() {
        while (!_state.value.accessRevoked) {
            loadJobs()
            loadBackground()
            delay(TICK_MS)
        }
    }

    suspend fun loadBackground() {
        _background.update { it.copy(fetch = Load.Loads) }
        when (val r = admin.getBackgroundJobs()) {
            is Outcome.Success -> _background.update { BackgroundUiState(view = r.data) }
            is Outcome.Failure -> {
                _background.update { it.copy(fetch = loadError(r)) }
                if (revoked(r)) _state.update { it.copy(accessRevoked = true) }
            }
        }
    }

    /**
     * Cancel, retry, start, clear: the result is the message — on a 409
     * the server's sentence, because only it knows why the job
     * no longer fits in the meantime. The list is reloaded afterward, either way.
     */
    internal suspend fun requestJobCancel(id: String): Message =
        afterJob(admin.requestJobCancel(id)) { Message.Resource(R.string.background_cancelled_ok) }

    internal suspend fun repeatJob(id: String): Message =
        afterJob(admin.repeatJob(id)) { Message.Resource(R.string.background_retried_ok) }

    internal suspend fun startJobKind(kind: String, name: String): Message =
        afterJob(admin.startJobKind(kind)) {
            Message.Resource(if (it) R.string.background_started else R.string.background_nothing_started, listOf(name))
        }

    internal suspend fun emptyJobKind(kind: String): Message =
        afterJob(admin.emptyJobKind(kind)) { Message.Quantity(R.plurals.background_emptied, it) }

    // In the viewModelScope, not the screen's scope: leaving the page
    // does not abort the action, and the sentence does not bypass the state.
    override fun cancelJob(id: String) = report { requestJobCancel(id) }
    override fun retryJob(id: String) = report { repeatJob(id) }
    override fun jobKindStart(kind: String, name: String) = report { startJobKind(kind, name) }
    override fun clearJobKind(kind: String) = report { emptyJobKind(kind) }

    private val _settingsNew = MutableStateFlow(false)

    /** Theme or default state changed: the app reloads its settings and acknowledges. */
    val settingsNew = _settingsNew.asStateFlow()

    fun settingsLoaded() {
        _settingsNew.value = false
    }

    fun defaultStateChoose(condition: Condition) = saved(settings = true) { setDefaultState(condition) }
    fun designChoose(theme: Design) = saved(settings = true) { setDesign(theme) }
    fun saveCacheDuration(hours: Int) = saved { setCacheDuration(hours) }
    fun cacheClear(everything: Boolean) =
        saved(R.string.monitoring_cache_cleared, failure = R.string.monitoring_cache_clear_failed) { emptyCache(everything) }
    fun saveLimits(rebrickable: Int, bricklink: Int, brickset: Int) =
        saved(R.string.monitoring_limits_saved) { setLimits(rebrickable, bricklink, brickset) }

    // A failure names its cause: a switch that silently flips back looks like a bug in the app.
    private fun saved(
        sentence: Int = R.string.monitoring_cache_saved,
        settings: Boolean = false,
        failure: Int = R.string.monitoring_save_failed,
        action: suspend () -> Outcome<Unit>,
    ) {
        viewModelScope.launch {
            when (val r = action()) {
                is Outcome.Failure -> messages.show(Message.Resource(failure, listOf(errorMessage(r))))
                is Outcome.Success -> {
                    if (settings) _settingsNew.value = true
                    messages.show(Message.Resource(sentence))
                }
            }
        }
    }

    private fun report(action: suspend () -> Message) {
        viewModelScope.launch { messages.show(action()) }
    }

    private suspend fun <T> afterJob(r: Outcome<T>, success: (T) -> Message): Message {
        val sentence = when (r) {
            is Outcome.Success -> success(r.data)
            is Outcome.Failure -> errorMessage(r)
        }
        loadBackground()
        return sentence
    }

    override fun refresh() {
        viewModelScope.launch { loadJobs() }
    }

    internal suspend fun loadJobs() {
        _state.update { it.copy(updated = true) }
        val r = admin.getJobs()
        _state.update {
            if (r is Outcome.Success)
                it.copy(jobs = r.data.jobs, jobSchedules = r.data.schedules, updated = false)
            else it.copy(updated = false, accessRevoked = it.accessRevoked || revoked(r))
        }
    }

    override fun showQueue() {
        viewModelScope.launch { loadQueue() }
    }

    internal suspend fun loadQueue() {
        _state.update { it.copy(queue = Load.Loads) }
        val r = admin.getBricksetQueue()
        _state.update { it.copy(queue = r.loadAs()) }
    }

    override fun retry(setNumber: String) = reportAfter(
        { repeatEntry(setNumber) },
        Message.Resource(R.string.monitoring_retry_queued, listOf(setNumber)),
        R.string.monitoring_retry_error, setNumber,
    )

    override fun remove(setNumber: String) = reportAfter(
        { removeEntry(setNumber) },
        Message.Resource(R.string.monitoring_entry_removed, listOf(setNumber)),
        R.string.monitoring_delete_error, setNumber,
    )

    /** [failure] takes the set number and the cause; „Fehler beim Löschen“ alone said neither. */
    private fun reportAfter(action: suspend () -> Outcome<Unit>, success: Message, failure: Int, setNumber: String) {
        viewModelScope.launch {
            messages.show(when (val r = action()) {
                is Outcome.Success -> success
                is Outcome.Failure -> Message.Resource(failure, listOf(setNumber, errorMessage(r)))
            })
        }
    }

    /** Retries a stuck entry; reloads the list afterward. */
    internal suspend fun repeatEntry(setNumber: String): Outcome<Unit> {
        val r = admin.retryBricksetEntry(setNumber)
        if (r is Outcome.Success) loadQueue()
        return r
    }

    /**
     * Removes an entry, anticipated in the display. If the server fails,
     * it reloads instead of writing the old copy back — something else may
     * have changed on the server in between.
     */
    internal suspend fun removeEntry(setNumber: String): Outcome<Unit> {
        _state.update { s ->
            val without = s.queue.dataOrNull()?.filter { it.setNumber != setNumber }
            if (without == null) s else s.copy(queue = Load.Data(without))
        }
        val r = admin.deleteBricksetEntry(setNumber)
        if (r is Outcome.Failure) loadQueue()
        return r
    }

    /**
     * A start button shows "starting…", then for four seconds after success what happened, then
     * its label again; a failure goes into the snackbar as a message. It is disabled
     * before the launch, otherwise a double tap would start it twice.
     */
    override fun launch(job: Jobstart) {
        if (job in _state.value.buttons) return
        setButton(job, Message.Resource(if (job == Jobstart.INSTRUCTIONS) R.string.common_loading else R.string.monitoring_starting))
        viewModelScope.launch {
            when (val r = startJob(job)) {
                is Outcome.Failure -> {
                    setButton(job, null)
                    val sentence = if (job == Jobstart.INSTRUCTIONS) R.string.monitoring_reimport_error else R.string.monitoring_start_error
                    messages.show(Message.Resource(sentence, listOf(errorMessage(r))))
                }
                is Outcome.Success -> {
                    setButton(job, r.data)
                    delay(STARTED_MS)
                    setButton(job, null)
                }
            }
        }
    }

    private fun setButton(job: Jobstart, state: Message?) =
        _state.update { it.copy(buttons = if (state == null) it.buttons - job else it.buttons + (job to state)) }

    /** Starts the job; returns what the button shows afterward, or the failure with its cause. */
    internal suspend fun startJob(job: Jobstart): Outcome<Message> {
        val started = Message.Resource(R.string.monitoring_started)
        return when (job) {
            Jobstart.CSV_RECONCILE -> admin.triggerCsvSync().then { Message.Resource(R.string.monitoring_sync_started_short) }
            Jobstart.PRICE_RUN -> admin.triggerPriceJob().then { started }
            Jobstart.STOCK_IMAGES -> admin.redownloadMissingImages().then { started }
            // The catalog's images, not the stock's next to it.
            Jobstart.CATALOG_IMAGES -> admin.queueCatalogImages().then { started }
            Jobstart.INSTRUCTIONS -> admin.reimportInstructions()
                .then { Message.Quantity(R.plurals.monitoring_reimport_enqueued, it) }
        }
    }

    /**
     * Cache numbers, API limits, cache duration and default state in one
     * go — one after another, because it would not be visibly faster in parallel, while
     * the order of the state changes would become unpredictable.
     */
    internal suspend fun loadCacheAndLimits() {
        _state.update { it.copy(settingsFetch = Load.Data(Unit)) }
        setting(admin.getCacheStats()) { s, d -> s.copy(cacheStats = d) }
        setting(admin.getApiLimits()) { s, d -> s.copy(apiLimits = d) }
        setting(admin.getCacheTtl()) { s, d -> s.copy(cacheTtl = d) }
        setting(account.getDefaultCondition()) { s, d -> s.copy(defaultState = d) }
    }

    /** All settings of the page again, after one of them failed. */
    fun reloadSettings() {
        viewModelScope.launch { loadCacheAndLimits(); loadDesignDefault() }
    }

    private fun <T> setting(r: Outcome<T>, take: (MonitoringUiState, T) -> MonitoringUiState) = when (r) {
        is Outcome.Success -> _state.update { take(it, r.data) }
        is Outcome.Failure -> _state.update { it.copy(settingsFetch = loadError(r)) }
    }

    internal suspend fun setCacheDuration(hours: Int): Outcome<Unit> {
        val r = admin.setCacheTtl(hours)
        if (r is Outcome.Success) _state.update { it.copy(cacheTtl = hours.toString()) }
        return r
    }

    /**
     * Clear the cache and fetch the numbers again right away — otherwise the old
     * ones would stay up, and nothing would show that something happened.
     */
    internal suspend fun emptyCache(everything: Boolean): Outcome<Unit> {
        val r = admin.clearCache(everything)
        if (r is Outcome.Success) loadCacheAndLimits()
        return r
    }

    /**
     * Set a job's schedule and fetch it anew, because the server normalizes it ("7:5" →
     * "07:05", at least five minutes): it should show what applies.
     */
    override fun setSchedule(name: String, time: String?, minutes: Int?) {
        saved { setJobSchedule(name, time, minutes) }
    }

    internal suspend fun setJobSchedule(name: String, time: String? = null, minutes: Int? = null): Outcome<Unit> {
        val r = admin.setJobSchedule(name, time, minutes)
        if (r is Outcome.Success) loadJobs()
        return r
    }

    /**
     * The default from /settings/theme. An older server does not know `default`
     * yet; there, the effective theme was also the default.
     */
    internal suspend fun loadDesignDefault() {
        setting(account.getAppTheme()) { s, d -> s.copy(defaultDesign = d.default ?: d.effective) }
    }

    /**
     * Switch the global theme. `loadSettings()` at the caller pulls the new
     * value into the state and remembers it, so that the display switches right away and
     * survives a cold start.
     */
    internal suspend fun setDesign(theme: Design): Outcome<Unit> {
        val r = admin.setAppTheme(theme)
        if (r is Outcome.Success) _state.update { it.copy(defaultDesign = theme) }
        return r
    }

    internal suspend fun setLimits(rebrickable: Int, bricklink: Int, brickset: Int): Outcome<Unit> {
        val r = admin.setApiLimits(rebrickable, bricklink, brickset)
        if (r is Outcome.Success) {
            setting(admin.getApiLimits()) { s, d -> s.copy(apiLimits = d) }
        }
        return r
    }

    /**
     * Set the default condition (new/used), anticipated in the display; if
     * the call fails, it is rolled back, otherwise the UI would claim something that was never
     * saved.
     */
    internal suspend fun setDefaultState(condition: Condition): Outcome<Unit> {
        val before = _state.value.defaultState
        _state.update { it.copy(defaultState = condition) }
        val r = admin.setDefaultCondition(condition)
        if (r is Outcome.Failure) _state.update { it.copy(defaultState = before) }
        return r
    }
}

/** What a started job shows on its button, the failure passed on unchanged with its cause. */
private inline fun <T, R> Outcome<T>.then(f: (T) -> R): Outcome<R> = when (this) {
    is Outcome.Success -> Outcome.Success(f(data))
    is Outcome.Failure -> this
}

/** Spacing of the polls, for as long as monitoring is visible. */
private const val TICK_MS = 5_000L

/** For this long, a start button shows that it has started. */
private const val STARTED_MS = 4_000L
