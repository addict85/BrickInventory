package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.sitzung.SitzungsRepository
import ch.brickinventoryapp.sitzung.AppUiState
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
 * Was MainActivity zeigt: Sitzung, Snackbar, die Pflichtmasken und das Ziel einer
 * angetippten Meldung. Die Arbeit der Sitzung macht der [SitzungsRepository]; er
 * lebt im Bereich der App und startet mit ihr (BrickInventoryApp), nicht mit diesem ViewModel.
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

    /** Offline gespeicherte Änderungen, die noch zum Server müssen — für die Leiste im Gerüst. */
    val offeneAenderungen: StateFlow<Int> = ausgangsmelder.offene
    fun clearSnackbar() { meldungen.acknowledge() }

    /** Mit Startpasswort zeigt MainActivity statt der App die Maske zum Ersetzen. */
    val startPasswordNeeded: StateFlow<Boolean> = passwordRequired.noetig

    /** Verwalterrechte ohne zweiten Faktor: MainActivity zeigt dessen Einrichtung. */
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
     * Zurück im Vordergrund: Ein in der Webapp geänderter Standard-Zustand greift so
     * auch in einer laufenden Sitzung, und Filterlisten, deren einziger Abruf beim
     * Start scheiterte, kommen nach. Abgemeldet fragt niemand.
     */
    fun inForeground() {
        if (!state.value.isLoggedIn) return
        loadSettings()
        loadHouseholdMembers()
        loadLagerorte()
    }

    // ── Meldung angetippt ────────────────────────────────────────────────────

    /** Der Intent kommt am Rand der App an, und dieser Rand ist die Activity. */
    fun setFromMessageRequest(setNummer: String?) {
        // Auch hier geprüft: Die Nummer wird Teil einer Navigationsroute.
        val sn = setNumberFromMessage(setNummer) ?: return
        _messageTarget.value = MessageTargetUiState(sn)
    }

    /** Erledigt — sonst springt die App bei der nächsten Rekomposition erneut. */
    fun setFromMessageAcknowledge() {
        _messageTarget.value = MessageTargetUiState(null)
    }
}
