package ch.brickinventoryapp.account.ui.viewmodel

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.Loeschvormerkung
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.session.abgeleitet
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.state.ui.gescheitert
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Zustand
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.ManagementRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.account.ui.AlarmUebersichtUiState
import ch.brickinventoryapp.account.ui.CsvUploadUiState
import ch.brickinventoryapp.session.ladeEinstellungen
import dagger.hilt.android.lifecycle.HiltViewModel
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.Gelesen
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn

/**
 * How large a CSV file may be — the same value as CSV_MAX_BYTES in
 * utils/dateiEmpfang.ts. The app must know the limit before sending 20 MB over
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
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val sync: Bestandsabgleich,
    private val konto: AccountRepository,
    private val verwaltung: ManagementRepository,
    private val alerts: AlarmRepository,
    private val teile: PartsRepository,
    private val reader: FileReader,
) : ViewModel(), Filterwahl by filter, EinstellungenAktionen {

    private val sessionObserved = Observed(sitzung.state)
    val state: StateFlow<AppUiState> = sessionObserved

    /** A storage location that's only deleted once the snackbar ends without "Undo". */
    val locationRoute = Loeschvormerkung<LocationEntryView>(viewModelScope) { deleteLocation(it.id) }

    /** The storage-locations page reads it; whoever opens it gets their own locations fresh. */
    private val storageObserved = Observed(filter.storageState.abgeleitet(locationRoute.wert) { st, weg ->
        if (weg == null) st else st.copy(eigene = st.eigene.filterNot { it.id == weg.id })
    })
    override val storageState: StateFlow<LagerUiState> = storageObserved

    init {
        sequenceSignOut(sitzung) { reset() }
        // On opening settings, not as a standing subscription: the state barely changes outside it.
        loadPerServer(sitzung, sessionObserved) { viewModelScope.launch { sitzung.ladeEinstellungen(konto) } }
        observeLoadOn(storageObserved) { loadOwnLocations() }
    }

    private val _csvUploadState = MutableStateFlow(CsvUploadUiState())
    val csvUploadState: StateFlow<CsvUploadUiState> = _csvUploadState.asStateFlow()

    private val _alarmOverview = MutableStateFlow(AlarmUebersichtUiState())
    val alarmOverview: StateFlow<AlarmUebersichtUiState> = _alarmOverview.asStateFlow()

    init {
        observeLoadOn(_alarmOverview) { loadAlarmOverview() }
    }

    // ── Currency and condition ──────────────────────────────────────────────────

    /** A different currency or condition changes every price: the cache fetches them anew. */
    override fun saveSettings(currency: Waehrung, condition: Zustand) {
        viewModelScope.launch {
            when (val r = konto.updateSettings(currency, condition)) {
                is Ergebnis.Erfolg -> {
                    meldungen.zeige(meldungen.text(R.string.vm_settings_saved))
                    sitzung.einstellungenGespeichert(currency, condition)
                    sync.bestand()
                }
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    /** Afterward, settings again: the server resolves the effective condition. */
    override fun saveUserDefaultCondition(condition: Zustand?) {
        viewModelScope.launch {
            when (val r = konto.setUserDefaultCondition(condition)) {
                is Ergebnis.Erfolg -> {
                    // The choice applies without a save button; without this message it stayed unclear whether it arrived.
                    meldungen.zeige(meldungen.text(R.string.vm_settings_saved))
                    sitzung.ladeEinstellungen(konto)
                }
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    // ── CSV-Import ───────────────────────────────────────────────────────────

    fun loadCsvHigh(art: CsvImportKind, datei: FileRef) {
        viewModelScope.launch {
            _csvUploadState.value = CsvUploadUiState(hochladen = Vorgang.Laeuft, art = art)
            val bytes = when (val g = reader.readAtMost(datei, CSV_MAX_BYTES)) {
                null -> {
                    _csvUploadState.value = CsvUploadUiState(hochladen = Vorgang.Fehlgeschlagen(Meldung.Resource(R.string.csv_upload_unreadable)))
                    return@launch
                }
                Gelesen.ToLarge -> {
                    _csvUploadState.value = CsvUploadUiState(hochladen = Vorgang.Fehlgeschlagen(
                        Meldung.Resource(R.string.csv_upload_too_big, listOf(CSV_MAX_BYTES / 1024 / 1024))))
                    return@launch
                }
                is Gelesen.Inhalt -> g.bytes
            }
            val name = reader.name(datei) ?: "import.csv"
            when (val r = verwaltung.importCsv(art, name, bytes)) {
                is Ergebnis.Erfolg -> {
                    _csvUploadState.value = CsvUploadUiState(ergebnis = r.data)
                    when (art) {
                        CsvImportKind.MERKLISTE -> sync.merkliste()
                        CsvImportKind.PREISALARME -> alertsNew()
                        CsvImportKind.TEILE -> sync.teile()
                        CsvImportKind.MINIFIGUREN -> sync.figuren()
                        CsvImportKind.SETS -> sync.sets()
                    }
                }
                is Ergebnis.Fehler -> _csvUploadState.value = CsvUploadUiState(hochladen = gescheitert(r))
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
            if (r is Ergebnis.Fehler) meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            val lokal = alerts.observeAlerts().first()
            if (r is Ergebnis.Erfolg || lokal.stand != null)
                _alarmOverview.value = AlarmUebersichtUiState(alerts = lokal.liste, geladen = true)
        }
    }

    override fun changeAlarmThreshold(setNumber: String, condition: Zustand, richtung: Alarmrichtung, schwelle: Geld) {
        waitingThresholds.remove(setNumber to condition)?.cancel()
        if (!schwelle.positive) { meldungen.zeige(meldungen.text(R.string.alerts_bad_value)); return }
        alarmLock { alerts.setPreisalarm(setNumber, richtung, schwelle, condition) }
    }

    /** Typed thresholds waiting out their quiet period — one per (set, condition). */
    private val waitingThresholds = mutableMapOf<Pair<String, Zustand>, Job>()

    /**
     * Saves while typing, debounced like in the set detail (Alarmeingabe.RUHE_MS): the
     * overview used to be the only place with a save button that only appeared on
     * change. In the ViewModel, so the input survives leaving the page.
     * An empty field doesn't delete here — the trash icon next to it is for that.
     */
    override fun setAlarmThreshold(setNumber: String, condition: Zustand, richtung: Alarmrichtung, roh: String) {
        val schluessel = setNumber to condition
        waitingThresholds.remove(schluessel)?.cancel()
        val schwelle = Alarmeingabe.zahl(roh) ?: return
        waitingThresholds[schluessel] = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            waitingThresholds.remove(schluessel)
            changeAlarmThreshold(setNumber, condition, richtung, schwelle)
        }
    }

    override fun deleteAlarm(setNumber: String, condition: Zustand) =
        alarmLock { alerts.deletePriceAlert(setNumber, condition) }

    /** Without a hyphen, the first version applies ("10294" → "10294-1"), as when entering. */
    override fun putAlarmAn(setNumber: String, condition: Zustand, richtung: Alarmrichtung, roh: String) {
        val nummer = setNumber.trim().let { if (it.isBlank() || it.contains('-')) it else "$it-1" }
        val schwelle = Alarmeingabe.zahl(roh)
        if (nummer.isBlank() || schwelle == null || !schwelle.positive) { meldungen.zeige(meldungen.text(R.string.alerts_bad_value)); return }
        alarmLock { alerts.setPreisalarm(nummer, richtung, schwelle, condition) }
    }

    /** Change and delete: call, report, refresh the overview if it's already showing. */
    private fun alarmLock(tun: suspend () -> Ergebnis<Unit>) {
        viewModelScope.launch {
            when (val r = tun()) {
                is Ergebnis.Erfolg -> Unit
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
            alertsNew()
        }
    }

    /** Fresh from the server, even after writing it ourselves: the price run sets the trigger, not the app. */
    private fun alertsNew(): Unit = if (_alarmOverview.value.geladen) loadAlarmOverview() else Unit

    // ── Lagerorte ────────────────────────────────────────────────────────────

    override fun putLocationAn(name: String) = locationLock { teile.putLocationAn(name).evaluate() }

    /** Renaming changes what's on sets, parts and figures; the repository pulls the cache along. */
    override fun nameLocationUm(id: Int, name: String) {
        val alt = filter.storageState.value.eigene.firstOrNull { it.id == id }?.name.orEmpty()
        locationLock { teile.nameLocationUm(id, alt, name).evaluate() }
    }

    /** The star: if the location is already the default, a second tap takes it away again. */
    override fun switchLocationDefault(id: Int, isDefault: Boolean) =
        locationLock { teile.setLocationDefault(if (isDefault) null else id).evaluate() }

    override fun locationDeleteReserve(ort: LocationEntryView) = locationRoute.reserve(ort)

    override fun deleteLocation(id: Int) = locationLock { teile.deleteLocation(id).evaluate() }

    private fun locationLock(tun: suspend () -> Pair<Boolean, String?>) {
        viewModelScope.launch {
            val (succeeded, fehler) = tun()
            if (!succeeded) { meldungen.zeige(fehler); return@launch }
            filter.ownLocationsNew()
        }
    }

    /** A rejection carries the server's message; an error with no message stays silent. */
    private fun Ergebnis<Unit>.evaluate(): Pair<Boolean, String?> = when (this) {
        is Ergebnis.Erfolg -> true to null
        is Ergebnis.Fehler -> false to meldungen.meldungFuerSnackbar(this)
    }

    private fun reset() {
        _csvUploadState.value = CsvUploadUiState()
        _alarmOverview.value = AlarmUebersichtUiState()
    }
}
