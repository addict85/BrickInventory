package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.session.SitzungsRepository
import ch.brickinventoryapp.session.AppUiState
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.SecondFactorRequired
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import ch.brickinventoryapp.model.ui.ScrollMemory

/**
 * What MainActivity displays: session, snackbar, the mandatory screens and the target of a
 * tapped notification. The session's work is done by [SitzungsRepository]; it
 * lives in the app's scope and starts with it (BrickInventoryApp), not with this ViewModel.
 */
@HiltViewModel
class AppViewModel @Inject constructor(
    private val sessionService: SitzungsRepository,
    private val meldungen: MeldungsKanal,
    sitzung: Sitzung,
    scopeService: Scope,
    val scrollMemory: ScrollMemory,
    ausgangsmelder: Ausgangsmelder,
    passwordRequired: PasswordRequired,
    zweiterFaktorPflicht: SecondFactorRequired,
) : ViewModel() {

    val state: StateFlow<AppUiState> = sitzung.state

    val snackbar = meldungen.meldung

    /** Changes stored offline that still need to reach the server — for the bar in the scaffold. */
    val offeneAenderungen: StateFlow<Int> = ausgangsmelder.offene
    fun clearSnackbar() { meldungen.acknowledge() }

    /** With a starting password, MainActivity shows the replacement screen instead of the app. */
    val startPasswordNeeded: StateFlow<Boolean> = passwordRequired.noetig

    /** Admin rights without a second factor: MainActivity shows its setup. */
    val secondFactorNeeded: StateFlow<Boolean> = zweiterFaktorPflicht.noetig

    val blickfeld = scopeService.konten
    val storageState = scopeService.lager

    private val _messageTarget = MutableStateFlow(MessageTargetUiState())
    val messageTarget: StateFlow<MessageTargetUiState> = _messageTarget.asStateFlow()

    fun secondFactorConfigured() = sessionService.secondFactorConfigured()

    fun logout(): Job = sessionService.abmelden()

    fun loadHouseholdMembers() = sessionService.loadMembers()

    fun loadLagerorte() = sessionService.ladeLagerorte()

    fun loadSettings() = sessionService.ladeEinstellungen()

    /**
     * Back in the foreground: a default state changed in the web app then also takes
     * effect in a running session, and filter lists whose only fetch failed at
     * startup catch up. Signed out, nobody asks.
     */
    fun inForeground() {
        if (!state.value.isLoggedIn) return
        loadSettings()
        loadHouseholdMembers()
        loadLagerorte()
    }

    // ── Meldung angetippt ────────────────────────────────────────────────────

    /** The intent arrives at the edge of the app, and that edge is the activity. */
    fun setFromMessageRequest(setNummer: String?) {
        // Also checked here: the number becomes part of a navigation route.
        val sn = setNumberFromMessage(setNummer) ?: return
        _messageTarget.value = MessageTargetUiState(sn)
    }

    /** Done — otherwise the app would jump again on the next recomposition. */
    fun setFromMessageAcknowledge() {
        _messageTarget.value = MessageTargetUiState(null)
    }
}
