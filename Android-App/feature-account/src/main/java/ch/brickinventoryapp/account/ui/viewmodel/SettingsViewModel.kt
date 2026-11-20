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
 * Wie gross eine CSV-Datei sein darf — derselbe Wert wie CSV_MAX_BYTES in
 * utils/dateiEmpfang.ts. Die App muss die Grenze kennen, bevor sie 20 MB durch
 * ein Mobilfunknetz schickt, um dann eine Absage zu bekommen.
 */
internal const val CSV_MAX_BYTES = 15L * 1024 * 1024

/**
 * Einstellungen und Verwaltung: Währung und Zustand, CSV-Import, Übersicht
 * der Preisalarme, eigene Lagerorte.
 *
 * Was am Gerät hängt (Sprache, Design bei Dunkelheit, Meldungen, Vorwärmen),
 * steht im AppViewModel; dieses ViewModel spricht nur mit dem Server.
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

    /** Ein Lagerort, der erst gelöscht wird, wenn die Snackbar ohne „Rückgängig“ endet. */
    val locationRoute = Loeschvormerkung<LocationEntryView>(viewModelScope) { deleteLocation(it.id) }

    /** Die Lagerorte-Seite liest ihn; wer sie öffnet, bekommt die eigenen Orte frisch. */
    private val storageObserved = Observed(filter.storageState.abgeleitet(locationRoute.wert) { st, weg ->
        if (weg == null) st else st.copy(eigene = st.eigene.filterNot { it.id == weg.id })
    })
    override val storageState: StateFlow<LagerUiState> = storageObserved

    init {
        sequenceSignOut(sitzung) { reset() }
        // Beim Öffnen der Einstellungen, nicht als Dauerabo: Der Zustand ändert sich ausserhalb kaum.
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

    // ── Währung und Zustand ──────────────────────────────────────────────────

    /** Eine andere Währung oder ein anderer Zustand ändert jeden Preis: Die Ablage holt sie neu. */
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

    /** Danach die Einstellungen neu: Der Server löst die wirksame Bedingung auf. */
    override fun saveUserDefaultCondition(condition: Zustand?) {
        viewModelScope.launch {
            when (val r = konto.setUserDefaultCondition(condition)) {
                is Ergebnis.Erfolg -> {
                    // Die Wahl gilt ohne Speichern-Knopf; ohne diese Meldung bliebe offen, ob sie ankam.
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
            // Gezeigt wird die Ablage; ohne Netz die zuletzt geholte Liste samt Meldung.
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

    /** Getippte Schwellen, die auf ihre Ruhezeit warten — je (Set, Zustand) eine. */
    private val waitingThresholds = mutableMapOf<Pair<String, Zustand>, Job>()

    /**
     * Speichert beim Tippen, entprellt wie im Set-Detail (Alarmeingabe.RUHE_MS): Die
     * Übersicht hatte als einzige Stelle einen Speichern-Knopf, der nur bei Änderung
     * erschien. Im ViewModel, damit die Eingabe das Verlassen der Seite übersteht.
     * Ein leeres Feld löscht hier nicht — dafür steht der Papierkorb daneben.
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

    /** Ohne Bindestrich gilt die erste Fassung („10294“ → „10294-1“), wie beim Erfassen. */
    override fun putAlarmAn(setNumber: String, condition: Zustand, richtung: Alarmrichtung, roh: String) {
        val nummer = setNumber.trim().let { if (it.isBlank() || it.contains('-')) it else "$it-1" }
        val schwelle = Alarmeingabe.zahl(roh)
        if (nummer.isBlank() || schwelle == null || !schwelle.positive) { meldungen.zeige(meldungen.text(R.string.alerts_bad_value)); return }
        alarmLock { alerts.setPreisalarm(nummer, richtung, schwelle, condition) }
    }

    /** Ändern und Löschen: rufen, melden, die Übersicht neu, wenn sie schon dasteht. */
    private fun alarmLock(tun: suspend () -> Ergebnis<Unit>) {
        viewModelScope.launch {
            when (val r = tun()) {
                is Ergebnis.Erfolg -> Unit
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
            alertsNew()
        }
    }

    /** Neu vom Server, auch nach eigenem Schreiben: Den Auslöser setzt der Preislauf, nicht die App. */
    private fun alertsNew(): Unit = if (_alarmOverview.value.geladen) loadAlarmOverview() else Unit

    // ── Lagerorte ────────────────────────────────────────────────────────────

    override fun putLocationAn(name: String) = locationLock { teile.putLocationAn(name).evaluate() }

    /** Umbenennen ändert, was an Sets, Teilen und Figuren steht; das Repository zieht die Ablage nach. */
    override fun nameLocationUm(id: Int, name: String) {
        val alt = filter.storageState.value.eigene.firstOrNull { it.id == id }?.name.orEmpty()
        locationLock { teile.nameLocationUm(id, alt, name).evaluate() }
    }

    /** Der Stern: Ist der Ort schon Vorgabe, nimmt der zweite Tipp sie wieder weg. */
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

    /** Eine Absage trägt den Satz des Servers; ein Fehler ohne Satz bleibt still. */
    private fun Ergebnis<Unit>.evaluate(): Pair<Boolean, String?> = when (this) {
        is Ergebnis.Erfolg -> true to null
        is Ergebnis.Fehler -> false to meldungen.meldungFuerSnackbar(this)
    }

    private fun reset() {
        _csvUploadState.value = CsvUploadUiState()
        _alarmOverview.value = AlarmUebersichtUiState()
    }
}
