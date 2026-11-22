package ch.brickinventoryapp.account.ui.viewmodel

import ch.brickinventoryapp.model.util.catchUnlessCancelled
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.update.util.checkedDescription
import ch.brickinventoryapp.update.util.checksumFits
import ch.brickinventoryapp.update.util.versionFits
import ch.brickinventoryapp.update.util.InstallMessage
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
import ch.brickinventoryapp.update.util.UpdateDescription
import java.io.File
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.data.LoginState
import ch.brickinventoryapp.update.data.UpdateRepository
import kotlinx.coroutines.Job
import ch.brickinventoryapp.update.util.UpdateDevice
import ch.brickinventoryapp.update.util.UpdateStatusStore
import ch.brickinventoryapp.model.ui.Message

/**
 * Self-update: check, load, offer to install. Check silently on start,
 * never load on its own, plus a button in settings. The silent
 * check reports no error: whoever starts without network hasn't asked; whoever
 * presses the button has.
 */
@HiltViewModel
class UpdateViewModel @Inject constructor(
    private val repo: UpdateRepository,
    private val loginState: LoginState,
    private val updateStatus: UpdateStatusStore,
    private val device: UpdateDevice,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : ViewModel(), UpdateActions.WithState {

    private val _state = MutableStateFlow(UpdateUiState(startCheck = updateStatus.startCheckEnabled()))
    val updateState = _state.asStateFlow()
    override val uiState: StateFlow<UpdateUiState> get() = updateState

    /** Der laufende Download; [cancelLoad] beendet ihn samt Teildatei. */
    private var loadJob: Job? = null

    init {
        // Reset on sign-out: progress or "ready to
        // install" would otherwise appear to the next user as their own operation.
        viewModelScope.launch {
            loginState.authTokenState.map { it.isNullOrBlank() }.distinctUntilChanged().drop(1)
                .filter { loggedOut -> loggedOut }
                .collect { _state.value = UpdateUiState(startCheck = updateStatus.startCheckEnabled()) }
        }
        // Check silently for a new version on every sign-in (if the switch is on):
        // no loading bar, no message without network. Here because the question applies to the whole app.
        viewModelScope.launch {
            loginState.authTokenState.map { !it.isNullOrBlank() }.distinctUntilChanged()
                .filter { loggedIn -> loggedIn }
                .collect { checkOnStart() }
        }
        // The installer session answers to a receiver, not here (util/AppUpdate.kt).
        viewModelScope.launch {
            InstallMessage.error.filter { it != null }.collect { reason ->
                InstallMessage.error.value = null
                _state.update { it.copy(error = Message.Resource(R.string.update_installation_failed, listOfNotNull(reason))) }
            }
        }
    }

    /**
     * Is there a newer version?
     *
     * @param still `true` on start: no loading bar, no error message. On
     *        button press, `false` — then the user sees both.
     */
    override fun checkOnStart() {
        if (updateStatus.startCheckEnabled()) checkOnUpdate(still = true)
    }

    override fun setStartCheck(an: Boolean) {
        updateStatus.setStartCheck(an)
        _state.update { it.copy(startCheck = an) }
    }

    override fun checkOnUpdate(still: Boolean) {
        viewModelScope.launch {
            _state.update { it.copy(check = if (still) Operation.Done else Operation.Running, error = null) }
            catchUnlessCancelled {
                val raw = repo.fetchDescription()
                // Only a signed description counts: write access to the repository alone
                // isn't enough then to suppress or redirect an update. After that
                // the address is still checked, not just trusted.
                val description = withContext(io) {
                    checkedDescription(raw, device.descriptionKey())
                }
                if (description == null || !isAllowedApkAddress(description.apkUrl)) {
                    _state.update {
                        it.copy(check = Operation.Done, checked = true, newerVersion = null,
                            error = if (still) null else Message.Resource(
                                if (description == null) R.string.update_description_unsigned else R.string.update_foreign_address))
                    }
                    return@launch
                }
                // No offer from a rolled-back description, one with a hint from an expired
                // one; settings say why (offerableVersion).
                val freshness = checkFresh(updateStatus, description, repo.runningVersion.code, System.currentTimeMillis() / 1000)
                _state.update {
                    it.copy(check = Operation.Done, checked = true,
                        newerVersion = offerableVersion(description, freshness, repo.runningVersion.code), error = null, freshness = freshness)
                }
            }.onFailure { _ ->
                _state.update {
                    it.copy(check = Operation.Done, checked = true,
                        error = if (still) null else Message.Resource(R.string.update_check_failed))
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
    override fun loadUpdate() {
        val version = _state.value.newerVersion ?: return
        if (loadJob?.isActive == true) return
        loadJob = viewModelScope.launch {
            if (!isAllowedApkAddress(version.apkUrl)) {
                _state.update { it.copy(error = Message.Resource(R.string.update_foreign_address)) }
                return@launch
            }
            _state.update { it.copy(progress = 0, error = null, readyToInstallation = false) }
            val target = device.updateFile()
            catchUnlessCancelled {
                repo.loadApk(version, target).collect { p -> _state.update { it.copy(progress = p) } }
                val wrong = withContext(io) { invalidApk(version, target) }
                if (wrong != null) {
                    target.delete()
                    _state.update { it.copy(progress = null, error = Message.Resource(wrong)) }
                    return@launch
                }
                val allowed = device.installMay()
                _state.update { it.copy(progress = null, readyToInstallation = true, permissionAbsent = !allowed) }
                if (allowed) startInstallation()
            }.onFailure { _ ->
                target.delete()
                _state.update {
                    it.copy(progress = null, error = Message.Resource(R.string.update_load_failed))
                }
            }
        }
    }

    /** The download aborts, the data layer deletes the partial file; a new attempt starts from scratch. */
    override fun cancelLoad() {
        loadJob?.cancel()
        loadJob = null
        _state.update { it.copy(progress = null) }
    }

    /**
     * The text for the first check the loaded APK fails, else null. First
     * the signed checksum (exactly this APK), then the signature, then the version —
     * all before the user is asked (util/AppUpdate.kt).
     */
    private fun invalidApk(description: UpdateDescription, target: File): Int? = when {
        !checksumFits(target, description.apkSha256) -> R.string.update_checksum_wrong
        !device.signatureFits(target) -> R.string.update_signature_wrong
        !versionFits(device.apkVersion(target), description.versionCode, repo.runningVersion.code) -> R.string.update_version_wrong
        else -> null
    }

    /**
     * Opens the system installer for the loaded APK. Two callers: the end of
     * [loadUpdate] and the "Install" button after the permission was granted
     * later. The signature is checked again, because the file sat on disk
     * during the detour into the system settings.
     */
    override fun startInstallation() {
        val reported = _state.value.newerVersion?.versionCode ?: 0
        val checksum = _state.value.newerVersion?.apkSha256.orEmpty()
        viewModelScope.launch {
            // Hashing roughly 46 MB plus two APK analyses: an ANR threatens on the main thread.
            // The order stays; `&&` breaks off on the first failure.
            val checked = withContext(io) {
                val file = device.updateFile()
                val real = file.isFile && checksumFits(file, checksum) && device.signatureFits(file) &&
                    versionFits(device.apkVersion(file), reported, repo.runningVersion.code)
                if (!real) file.delete()
                file.takeIf { real }
            }
            if (checked == null) {
                _state.update {
                    it.copy(readyToInstallation = false, error = Message.Resource(R.string.update_signature_wrong))
                }
                return@launch
            }
            if (!device.installMay()) {
                _state.update { it.copy(permissionAbsent = true) }
                return@launch
            }
            withContext(io) { runCatching { device.install(checked) } }
                .onFailure {
                    _state.update { s -> s.copy(error = Message.Resource(R.string.update_installer_missing)) }
                }
        }
    }
}
