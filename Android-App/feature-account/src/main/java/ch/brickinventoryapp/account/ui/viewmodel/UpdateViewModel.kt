package ch.brickinventoryapp.account.ui.viewmodel

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.update.util.checkedDescription
import ch.brickinventoryapp.update.util.checksumFits
import ch.brickinventoryapp.update.util.versionFits
import ch.brickinventoryapp.update.util.Installationsmeldung
import ch.brickinventoryapp.update.util.isAllowedApkAddress
import ch.brickinventoryapp.update.util.offerableVersion
import ch.brickinventoryapp.update.util.checkFresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject
import ch.brickinventoryapp.update.util.UpdateBeschreibung
import java.io.File
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.update.data.UpdateRepository
import kotlinx.coroutines.Job
import ch.brickinventoryapp.update.util.UpdateDevice
import ch.brickinventoryapp.update.util.UpdateStatusStore
import ch.brickinventoryapp.model.ui.Meldung

/**
 * Selbstaktualisierung: nachsehen, laden, installieren lassen. Beim Start still
 * prüfen, nie von allein laden, dazu ein Knopf in den Einstellungen. Die stille
 * Prüfung meldet keinen Fehler: Wer ohne Netz startet, hat nichts gefragt; wer den
 * Knopf drückt, schon.
 */
@HiltViewModel
class UpdateViewModel @Inject constructor(
    private val repo: UpdateRepository,
    private val anmeldestand: Anmeldestand,
    private val updateStatus: UpdateStatusStore,
    private val geraet: UpdateDevice,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : ViewModel(), UpdateAktionen.WithState {

    private val _state = MutableStateFlow(UpdateUiState(startpruefung = updateStatus.startpruefungAn()))
    val updateState = _state.asStateFlow()
    override val zustand: StateFlow<UpdateUiState> get() = updateState

    /** Der laufende Download; [cancelLoad] beendet ihn samt Teildatei. */
    private var loadJob: Job? = null

    init {
        // Beim Abmelden zuruecksetzen: Ein Fortschritt oder „bereit zur
        // Installation" erschiene dem naechsten Nutzer sonst als sein Vorgang.
        viewModelScope.launch {
            anmeldestand.authTokenState.map { it.isNullOrBlank() }.distinctUntilChanged().drop(1)
                .filter { abgemeldet -> abgemeldet }
                .collect { _state.value = UpdateUiState(startpruefung = updateStatus.startpruefungAn()) }
        }
        // Mit jeder Anmeldung still nach einer neuen Fassung sehen (wenn der Schalter an ist):
        // kein Ladebalken, keine Meldung ohne Netz. Hier, weil die Frage der ganzen App gilt.
        viewModelScope.launch {
            anmeldestand.authTokenState.map { !it.isNullOrBlank() }.distinctUntilChanged()
                .filter { angemeldet -> angemeldet }
                .collect { pruefeBeimStart() }
        }
        // Die Installer-Sitzung antwortet an einen Empfänger, nicht hierher (util/AppUpdate.kt).
        viewModelScope.launch {
            Installationsmeldung.fehler.filter { it != null }.collect { grund ->
                Installationsmeldung.fehler.value = null
                _state.update { it.copy(fehler = Meldung.Resource(R.string.update_installation_fehlgeschlagen, listOfNotNull(grund))) }
            }
        }
    }

    /**
     * Gibt es eine neuere Fassung?
     *
     * @param still Beim Start `true`: kein Ladebalken, keine Fehlermeldung. Auf
     *        Knopfdruck `false` — dann sieht der Nutzer beides.
     */
    override fun pruefeBeimStart() {
        if (updateStatus.startpruefungAn()) pruefeAufUpdate(still = true)
    }

    override fun setStartpruefung(an: Boolean) {
        updateStatus.setStartpruefung(an)
        _state.update { it.copy(startpruefung = an) }
    }

    override fun pruefeAufUpdate(still: Boolean) {
        viewModelScope.launch {
            _state.update { it.copy(check = if (still) Vorgang.Fertig else Vorgang.Laeuft, fehler = null) }
            fangeAusserAbbruch {
                val roh = repo.fetchDescription()
                // Nur eine signierte Beschreibung zählt: Schreibrecht am Repository allein
                // reicht dann nicht, um ein Update zu unterdrücken oder umzuleiten. Danach
                // wird die Adresse trotzdem geprüft, nicht geglaubt.
                val beschreibung = withContext(io) {
                    checkedDescription(roh, geraet.descriptionKey())
                }
                if (beschreibung == null || !isAllowedApkAddress(beschreibung.apkUrl)) {
                    _state.update {
                        it.copy(check = Vorgang.Fertig, geprueft = true, newerVersion = null,
                            fehler = if (still) null else Meldung.Resource(
                                if (beschreibung == null) R.string.update_beschreibung_unsigniert else R.string.update_fremde_adresse))
                    }
                    return@launch
                }
                // Aus einer zurückgesetzten Beschreibung kein Angebot, aus einer abgelaufenen
                // eines mit Hinweis; die Einstellungen sagen, warum (offerableVersion).
                val frische = checkFresh(updateStatus, beschreibung, repo.runningVersion.code, System.currentTimeMillis() / 1000)
                _state.update {
                    it.copy(check = Vorgang.Fertig, geprueft = true,
                        newerVersion = offerableVersion(beschreibung, frische, repo.runningVersion.code), fehler = null, frische = frische)
                }
            }.onFailure { _ ->
                _state.update {
                    it.copy(check = Vorgang.Fertig, geprueft = true,
                        fehler = if (still) null else Meldung.Resource(R.string.update_pruefung_fehlgeschlagen))
                }
            }
        }
    }

    /**
     * „Später“ im Start-Hinweis: für diesen App-Lauf nicht mehr fragen. Der Zustand
     * bleibt — es gibt weiterhin eine neuere Fassung, und der Punkt am Konto-Symbol
     * sagt das weiter. Weggeklickt ist nur die Frage, nicht der Befund.
     */
    override fun closeUpdateHint() {
        _state.update { it.copy(dialogRejected = true) }
    }

    /**
     * Lädt das APK und bietet es zur Installation an. Drei Bedingungen, bevor etwas
     * installiert wird: 1. Die Adresse zeigt in unsere Release-Ablage (schon in der Prüfung,
     * hier nochmal — zwischen Prüfung und Klick kann ein neuer Zustand stehen). 2. Die
     * Signatur stimmt mit der installierten App überein.
     */
    override fun ladeUpdate() {
        val fassung = _state.value.newerVersion ?: return
        if (loadJob?.isActive == true) return
        loadJob = viewModelScope.launch {
            if (!isAllowedApkAddress(fassung.apkUrl)) {
                _state.update { it.copy(fehler = Meldung.Resource(R.string.update_fremde_adresse)) }
                return@launch
            }
            _state.update { it.copy(fortschritt = 0, fehler = null, readyToInstallation = false) }
            val ziel = geraet.updateFile()
            fangeAusserAbbruch {
                repo.loadApk(fassung, ziel).collect { p -> _state.update { it.copy(fortschritt = p) } }
                val falsch = withContext(io) { invalidApk(fassung, ziel) }
                if (falsch != null) {
                    ziel.delete()
                    _state.update { it.copy(fortschritt = null, fehler = Meldung.Resource(falsch)) }
                    return@launch
                }
                val erlaubt = geraet.installMay()
                _state.update { it.copy(fortschritt = null, readyToInstallation = true, permissionAbsent = !erlaubt) }
                if (erlaubt) startInstallation()
            }.onFailure { _ ->
                ziel.delete()
                _state.update {
                    it.copy(fortschritt = null, fehler = Meldung.Resource(R.string.update_laden_fehlgeschlagen))
                }
            }
        }
    }

    /** Der Download bricht ab, die Teildatei löscht die Datenschicht; ein neuer Versuch beginnt von vorn. */
    override fun cancelLoad() {
        loadJob?.cancel()
        loadJob = null
        _state.update { it.copy(fortschritt = null) }
    }

    /**
     * Der Text zur ersten Prüfung, die das geladene APK nicht besteht, sonst null. Erst
     * die signierte Prüfsumme (genau dieses APK), dann die Signatur, dann die Fassung —
     * alles, bevor der Nutzer gefragt wird (util/AppUpdate.kt).
     */
    private fun invalidApk(beschreibung: UpdateBeschreibung, ziel: File): Int? = when {
        !checksumFits(ziel, beschreibung.apkSha256) -> R.string.update_pruefsumme_falsch
        !geraet.signatureFits(ziel) -> R.string.update_signatur_falsch
        !versionFits(geraet.apkVersion(ziel), beschreibung.versionCode, repo.runningVersion.code) -> R.string.update_fassung_falsch
        else -> null
    }

    /**
     * Öffnet den System-Installer für das geladene APK. Zwei Aufrufer: das Ende von
     * [ladeUpdate] und der Knopf „Installieren“ nach nachträglich erteilter Erlaubnis.
     * Die Signatur wird erneut geprüft, weil die Datei während des Ausflugs in die
     * Systemeinstellungen auf der Platte liegt.
     */
    override fun startInstallation() {
        val gemeldet = _state.value.newerVersion?.versionCode ?: 0
        val checksum = _state.value.newerVersion?.apkSha256.orEmpty()
        viewModelScope.launch {
            // Rund 46 MB hashen und zwei APK-Analysen: auf dem Hauptfaden droht ein ANR.
            // Die Reihenfolge bleibt; `&&` bricht beim ersten Fehlschlag ab.
            val geprueft = withContext(io) {
                val datei = geraet.updateFile()
                val echt = datei.isFile && checksumFits(datei, checksum) && geraet.signatureFits(datei) &&
                    versionFits(geraet.apkVersion(datei), gemeldet, repo.runningVersion.code)
                if (!echt) datei.delete()
                datei.takeIf { echt }
            }
            if (geprueft == null) {
                _state.update {
                    it.copy(readyToInstallation = false, fehler = Meldung.Resource(R.string.update_signatur_falsch))
                }
                return@launch
            }
            if (!geraet.installMay()) {
                _state.update { it.copy(permissionAbsent = true) }
                return@launch
            }
            withContext(io) { runCatching { geraet.install(geprueft) } }
                .onFailure {
                    _state.update { s -> s.copy(fehler = Meldung.Resource(R.string.update_installer_fehlt)) }
                }
        }
    }
}
