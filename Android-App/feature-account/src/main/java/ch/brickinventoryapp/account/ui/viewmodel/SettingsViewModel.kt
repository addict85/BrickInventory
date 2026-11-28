package ch.brickinventoryapp.account.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.account.ui.AlarmOverviewUiState
import ch.brickinventoryapp.account.ui.CsvUploadUiState
import ch.brickinventoryapp.data.account.AccountRepository
import ch.brickinventoryapp.data.account.ManagementRepository
import ch.brickinventoryapp.data.alarm.AlarmInput
import ch.brickinventoryapp.data.collection.AlarmRepository
import ch.brickinventoryapp.data.local.StockReconciliation
import ch.brickinventoryapp.data.parts.PartsRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.file.Read
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.loadSettings
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.state.ui.failed
import ch.brickinventoryapp.state.ui.viewmodel.DeletionMark
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * How large a CSV file may be — the same value as CSV_MAX_BYTES in
 * `utils/dateiEmpfang.ts`. The app must know the limit before sending 20 MB over
 * a mobile network only to get a rejection.
 */
internal const val CSV_MAX_BYTES = 15L * 1024 * 1024

/**
 * Settings and management: currency and condition, CSV import, overview
 * of price alerts, own storage locations.
 *
 * What's tied to the device (language, design in the dark, notifications, prewarming)
 * lives in AppViewModel; this ViewModel only talks to the server.
 */
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val session: Session,
    private val filter: FilterChoice,
    private val messages: Messages,
    private val sync: StockReconciliation,
    private val account: AccountRepository,
    private val admin: ManagementRepository,
    private val alerts: AlarmRepository,
    private val parts: PartsRepository,
    private val reader: FileReader,
) : ViewModel(), FilterChoice by filter, SettingsActions {

    private val sessionObserved = Observed(session.state)
    val state: StateFlow<AppUiState> = sessionObserved

    /** A storage location that's only deleted once the snackbar ends without "Undo". */
    val locationRoute = DeletionMark<LocationEntryView>(viewModelScope) { deleteLocation(it.id) }

    /** The storage-locations page reads it; whoever opens it gets their own locations fresh. */
    private val storageObserved = Observed(combine(filter.storageState, locationRoute.value, ::withoutGone)
        .stateIn(viewModelScope, SharingStarted.Eagerly, withoutGone(filter.storageState.value, locationRoute.value.value)))

    private fun withoutGone(st: StorageUiState, gone: LocationEntryView?): StorageUiState =
        if (gone == null) st else st.copy(own = st.own.filterNot { it.id == gone.id })
    override val storageState: StateFlow<StorageUiState> = storageObserved

    init {
        logoutSequence(session) { reset() }
        // On opening settings, not as a standing subscription: the state barely changes outside it.
        loadPerServer(session, sessionObserved) { viewModelScope.launch { session.loadSettings(account) } }
        observeLoadOn(storageObserved) { loadOwnLocations() }
    }

    private val _csvUploadState = MutableStateFlow(CsvUploadUiState())
    val csvUploadState: StateFlow<CsvUploadUiState> = _csvUploadState.asStateFlow()

    private val _alarmOverview = MutableStateFlow(AlarmOverviewUiState())
    val alarmOverview: StateFlow<AlarmOverviewUiState> = _alarmOverview.asStateFlow()

    init {
        observeLoadOn(_alarmOverview) { loadAlarmOverview() }
    }

    // ── Currency and condition ──────────────────────────────────────────────────

    /** A different currency or condition changes every price: the cache fetches them anew. */
    override fun saveSettings(currency: CurrencyCode, condition: Condition) {
        viewModelScope.launch {
            when (val r = account.updateSettings(currency, condition)) {
                is Outcome.Success -> {
                    messages.show(messages.text(R.string.vm_settings_saved))
                    session.settingsSaved(currency, condition)
                    sync.stock()
                }
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
            }
        }
    }

    /** Afterward, settings again: the server resolves the effective condition. */
    override fun saveUserDefaultCondition(condition: Condition?) {
        viewModelScope.launch {
            when (val r = account.setUserDefaultCondition(condition)) {
                is Outcome.Success -> {
                    // The choice applies without a save button; without this message it stayed unclear whether it arrived.
                    messages.show(messages.text(R.string.vm_settings_saved))
                    session.loadSettings(account)
                }
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r)?.let { messages.text(R.string.vm_error, it) })
            }
        }
    }

    // ── CSV-Import ───────────────────────────────────────────────────────────

    fun loadCsvHigh(kind: CsvImportKind, file: FileRef) {
        viewModelScope.launch {
            _csvUploadState.value = CsvUploadUiState(upload = Operation.Running, kind = kind)
            val bytes = when (val g = reader.readAtMost(file, CSV_MAX_BYTES)) {
                null -> {
                    _csvUploadState.value = CsvUploadUiState(upload = Operation.Failed(Message.Resource(R.string.csv_upload_unreadable)))
                    return@launch
                }
                Read.ToLarge -> {
                    _csvUploadState.value = CsvUploadUiState(upload = Operation.Failed(
                        Message.Resource(R.string.csv_upload_too_big, listOf(CSV_MAX_BYTES / 1024 / 1024))))
                    return@launch
                }
                is Read.Content -> g.bytes
            }
            val name = reader.name(file) ?: "import.csv"
            when (val r = admin.importCsv(kind, name, bytes)) {
                is Outcome.Success -> {
                    _csvUploadState.value = CsvUploadUiState(outcome = r.data)
                    when (kind) {
                        CsvImportKind.WANTED_LIST -> sync.wantedList()
                        CsvImportKind.PRICE_ALARMS -> alertsNew()
                        CsvImportKind.PARTS -> sync.parts()
                        CsvImportKind.MINIFIGS -> sync.figures()
                        CsvImportKind.SETS -> sync.sets()
                    }
                }
                is Outcome.Failure -> _csvUploadState.value = CsvUploadUiState(upload = failed(r))
            }
        }
    }

    fun csvUploadRoute() {
        _csvUploadState.value = CsvUploadUiState()
    }

    // ── Preisalarme ──────────────────────────────────────────────────────────

    override fun loadAlarmOverview() {
        viewModelScope.launch {
            // What's shown is the cache; without network, the last-fetched list plus a message.
            val r = alerts.refreshAlerts()
            if (r is Outcome.Failure) messages.show(messages.messageForSnackbar(r))
            val local = alerts.observeAlerts().first()
            if (r is Outcome.Success || local.state != null)
                _alarmOverview.value = AlarmOverviewUiState(alerts = local.list, loaded = true)
        }
    }

    override fun changeAlarmThreshold(setNumber: String, condition: Condition, direction: AlarmDirection, threshold: Money) {
        waitingThresholds.remove(setNumber to condition)?.cancel()
        if (!threshold.positive) { messages.show(messages.text(R.string.alerts_bad_value)); return }
        alarmLock { alerts.setPriceAlarm(setNumber, direction, threshold, condition) }
    }

    /** Typed thresholds waiting out their quiet period — one per (set, condition). */
    private val waitingThresholds = mutableMapOf<Pair<String, Condition>, Job>()

    /**
     * Saves while typing, debounced like in the set detail (AlarmInput.QUIET_MS): the
     * overview used to be the only place with a save button that only appeared on
     * change. In the ViewModel, so the input survives leaving the page.
     * An empty field doesn't delete here — the trash icon next to it is for that.
     */
    override fun setAlarmThreshold(setNumber: String, condition: Condition, direction: AlarmDirection, raw: String) {
        val key = setNumber to condition
        waitingThresholds.remove(key)?.cancel()
        val threshold = AlarmInput.number(raw) ?: return
        waitingThresholds[key] = viewModelScope.launch {
            delay(AlarmInput.QUIET_MS)
            waitingThresholds.remove(key)
            changeAlarmThreshold(setNumber, condition, direction, threshold)
        }
    }

    override fun deleteAlarm(setNumber: String, condition: Condition) =
        alarmLock { alerts.deletePriceAlert(setNumber, condition) }

    /** Without a hyphen, the first version applies ("10294" → "10294-1"), as when entering. */
    override fun createAlarm(setNumber: String, condition: Condition, direction: AlarmDirection, raw: String) {
        val number = setNumber.trim().let { if (it.isBlank() || it.contains('-')) it else "$it-1" }
        val threshold = AlarmInput.number(raw)
        if (number.isBlank() || threshold == null || !threshold.positive) { messages.show(messages.text(R.string.alerts_bad_value)); return }
        alarmLock { alerts.setPriceAlarm(number, direction, threshold, condition) }
    }

    /** Change and delete: call, report, refresh the overview if it's already showing. */
    private fun alarmLock(perform: suspend () -> Outcome<Unit>) {
        viewModelScope.launch {
            when (val r = perform()) {
                is Outcome.Success -> Unit
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
            }
            alertsNew()
        }
    }

    /** Fresh from the server, even after writing it ourselves: the price run sets the trigger, not the app. */
    private fun alertsNew(): Unit = if (_alarmOverview.value.loaded) loadAlarmOverview() else Unit

    // ── Lagerorte ────────────────────────────────────────────────────────────

    override fun createLocation(name: String) = locationLock { parts.createLocation(name).evaluate() }

    /** Renaming changes what's on sets, parts and figures; the repository pulls the cache along. */
    override fun renameLocation(id: Int, name: String) {
        val old = filter.storageState.value.own.firstOrNull { it.id == id }?.name.orEmpty()
        locationLock { parts.renameLocation(id, old, name).evaluate() }
    }

    /** The star: if the location is already the default, a second tap takes it away again. */
    override fun switchLocationDefault(id: Int, isDefault: Boolean) =
        locationLock { parts.setLocationDefault(if (isDefault) null else id).evaluate() }

    override fun locationDeleteReserve(location: LocationEntryView) = locationRoute.reserve(location)

    override fun deleteLocation(id: Int) = locationLock { parts.deleteLocation(id).evaluate() }

    private fun locationLock(perform: suspend () -> Pair<Boolean, String?>) {
        viewModelScope.launch {
            val (succeeded, error) = perform()
            if (!succeeded) { messages.show(error); return@launch }
            filter.ownLocationsNew()
        }
    }

    /** A rejection carries the server's message; an error with no message stays silent. */
    private fun Outcome<Unit>.evaluate(): Pair<Boolean, String?> = when (this) {
        is Outcome.Success -> true to null
        is Outcome.Failure -> false to messages.messageForSnackbar(this)
    }

    private fun reset() {
        _csvUploadState.value = CsvUploadUiState()
        _alarmOverview.value = AlarmOverviewUiState()
    }
}
