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
 * Self-update: check, load, offer to install. Check silently on start,
 * never load on its own, plus a button in settings. The silent
 * check reports no error: whoever starts without network hasn't asked; whoever
 * presses the button has.
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
        // Reset on sign-out: progress or "ready to
        // install" would otherwise appear to the next user as their own operation.
        viewModelScope.launch {
            anmeldestand.authTokenState.map { it.isNullOrBlank() }.distinctUntilChanged().drop(1)
                .filter { abgemeldet -> abgemeldet }
                .collect { _state.value = UpdateUiState(startpruefung = updateStatus.startpruefungAn()) }
        }
        // Check silently for a new version on every sign-in (if the switch is on):
        // no loading bar, no message without network. Here because the question applies to the whole app.
        viewModelScope.launch {
            anmeldestand.authTokenState.map { !it.isNullOrBlank() }.distinctUntilChanged()
                .filter { angemeldet -> angemeldet }
                .collect { pruefeBeimStart() }
        }
        // The installer session answers to a receiver, not here (util/AppUpdate.kt).
        viewModelScope.launch {
            Installationsmeldung.fehler.filter { it != null }.collect { grund ->
                Installationsmeldung.fehler.value = null
                _state.update { it.copy(fehler = Meldung.Resource(R.string.update_installation_fehlgeschlagen, listOfNotNull(grund))) }
            }
        }
    }

    /**
     * Is there a newer version?
     *
     * @param still `true` on start: no loading bar, no error message. On
     *        button press, `false` — then the user sees both.
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
                // Only a signed description counts: write access to the repository alone
                // isn't enough then to suppress or redirect an update. After that
                // the address is still checked, not just trusted.
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
                // No offer from a rolled-back description, one with a hint from an expired
                // one; settings say why (offerableVersion).
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
     * "Later" in the start notice: don't ask again for this app run. The state
     * stays — there's still a newer version, and the dot on the account icon
     * keeps saying so. Only the question is dismissed, not the finding.
     */
    override fun closeUpdateHint() {
        _state.update { it.copy(dialogRejected = true) }
    }

    /**
     * Loads the APK and offers it for installation. Three conditions before anything
     * is installed: 1. The address points into our release store (already checked,
     * here again — a new state can appear between the check and the tap). 2. The
     * signature matches the installed app.
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

    /** The download aborts, the data layer deletes the partial file; a new attempt starts from scratch. */
    override fun cancelLoad() {
        loadJob?.cancel()
        loadJob = null
        _state.update { it.copy(fortschritt = null) }
    }

    /**
     * The text for the first check the loaded APK fails, else null. First
     * the signed checksum (exactly this APK), then the signature, then the version —
     * all before the user is asked (util/AppUpdate.kt).
     */
    private fun invalidApk(beschreibung: UpdateBeschreibung, ziel: File): Int? = when {
        !checksumFits(ziel, beschreibung.apkSha256) -> R.string.update_pruefsumme_falsch
        !geraet.signatureFits(ziel) -> R.string.update_signatur_falsch
        !versionFits(geraet.apkVersion(ziel), beschreibung.versionCode, repo.runningVersion.code) -> R.string.update_fassung_falsch
        else -> null
    }

    /**
     * Opens the system installer for the loaded APK. Two callers: the end of
     * [ladeUpdate] and the "Install" button after the permission was granted
     * later. The signature is checked again, because the file sat on disk
     * during the detour into the system settings.
     */
    override fun startInstallation() {
        val gemeldet = _state.value.newerVersion?.versionCode ?: 0
        val checksum = _state.value.newerVersion?.apkSha256.orEmpty()
        viewModelScope.launch {
            // Hashing roughly 46 MB plus two APK analyses: an ANR threatens on the main thread.
            // The order stays; `&&` breaks off on the first failure.
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
