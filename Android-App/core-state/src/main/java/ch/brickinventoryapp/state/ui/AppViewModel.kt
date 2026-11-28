package ch.brickinventoryapp.state.ui

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.SessionRepository
import ch.brickinventoryapp.uistate.ScrollMemory
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

/**
 * What MainActivity displays: session, snackbar, the mandatory screens and the target of a
 * tapped notification. The session's work is done by [SessionRepository]; it
 * lives in the app's scope and starts with it (BrickInventoryApp), not with this ViewModel.
 */
@HiltViewModel
class AppViewModel @Inject constructor(
    private val sessionService: SessionRepository,
    private val messages: MessageChannel,
    session: Session,
    scopeService: Scope,
    val scrollMemory: ScrollMemory,
    outboxNotifier: OutboxNotifier,
    passwordRequired: PasswordRequired,
    secondFactorRequired: SecondFactorRequired,
) : ViewModel() {

    val state: StateFlow<AppUiState> = session.state

    val snackbar = messages.message

    /** Changes stored offline that still need to reach the server — for the bar in the scaffold. */
    val pendingChanges: StateFlow<Int> = outboxNotifier.pending
    fun clearSnackbar() { messages.acknowledge() }

    /** With a starting password, MainActivity shows the replacement screen instead of the app. */
    val startPasswordNeeded: StateFlow<Boolean> = passwordRequired.needed

    /** Admin rights without a second factor: MainActivity shows its setup. */
    val secondFactorNeeded: StateFlow<Boolean> = secondFactorRequired.needed

    val viewport = scopeService.accounts
    val storageState = scopeService.storage

    private val _messageTarget = MutableStateFlow(MessageTargetUiState())
    val messageTarget: StateFlow<MessageTargetUiState> = _messageTarget.asStateFlow()

    fun secondFactorConfigured() = sessionService.secondFactorConfigured()

    fun logout(): Job = sessionService.logout()

    fun loadHouseholdMembers() = sessionService.loadMembers()

    fun loadStorageLocations() = sessionService.fetchStorageLocations()

    fun loadSettings() = sessionService.loadSettings()

    /**
     * Back in the foreground: a default state changed in the web app then also takes
     * effect in a running session, and filter lists whose only fetch failed at
     * startup catch up. Signed out, nobody asks.
     */
    fun inForeground() {
        if (!state.value.isLoggedIn) return
        loadSettings()
        loadHouseholdMembers()
        loadStorageLocations()
    }

    // ── Message tapped ─────────────────────────────────────────────────────────

    /** The intent arrives at the edge of the app, and that edge is the activity. */
    fun setFromMessageRequest(setNumber: String?) {
        // Also checked here: the number becomes part of a navigation route.
        val sn = setNumberFromMessage(setNumber) ?: return
        _messageTarget.value = MessageTargetUiState(sn)
    }

    /** Done — otherwise the app would jump again on the next recomposition. */
    fun setFromMessageAcknowledge() {
        _messageTarget.value = MessageTargetUiState(null)
    }
}
