package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.model.RegisterRequest
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.AnmeldeUiState
import ch.brickinventoryapp.ui.qrFehler
import ch.brickinventoryapp.util.NetworkPolicy
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Server einrichten, anmelden (Passwort, zweiter Faktor, QR), Konto anlegen,
 * Passwort vergessen.
 *
 * An die Activity gebunden: Der QR-Weg verlässt die Einrichtung, während die
 * Anmeldung noch läuft — an das Ziel gebunden, bräche ihr Abruf dabei ab.
 * Was nach der Anmeldung geladen wird, stösst das AppViewModel an, sobald der
 * Token in der Ablage steht.
 */
@HiltViewModel
class AnmeldungViewModel @Inject constructor(
    dienste: AppDienste,
    private val admin: AdminRepository,
    private val ablage: Anmeldeablage,
) : BereichsViewModel(dienste) {

    private val _anmeldeState = MutableStateFlow(AnmeldeUiState())
    val anmeldeState: StateFlow<AnmeldeUiState> = _anmeldeState.asStateFlow()

    /** Zuerst die Erlaubnis für Klartext, dann die Adresse: Die ersten Anfragen folgen sofort. */
    fun saveServerUrl(url: String, klartextBestaetigt: Boolean = false) {
        viewModelScope.launch {
            if (klartextBestaetigt) NetworkPolicy.klartextHost(url)?.let { ablage.bestaetigeKlartext(it) }
            ablage.saveServerUrl(url)
        }
    }

    fun login(username: String, password: String, code: String? = null) {
        viewModelScope.launch {
            _anmeldeState.update { it.copy(loginLaeuft = true, loginError = null) }
            val url = ablage.serverUrlJetzt()
            when (val r = admin.login(url, username, password, code?.trim()?.takeIf { it.isNotEmpty() })) {
                is Result.Success -> when {
                    // Erstes Mal nur das Codefeld zeigen; mit Code den Satz des Servers.
                    r.data.zweiterFaktor -> _anmeldeState.update { it.copy(codeNoetig = true, loginLaeuft = false,
                        loginError = if (code.isNullOrBlank()) null else r.data.error) }
                    r.data.success && r.data.token != null -> {
                        angemeldet(r.data.token, r.data.user?.username ?: username, r.data.user?.isAdmin == true)
                        _anmeldeState.update { it.copy(codeNoetig = false, loginLaeuft = false) }
                    }
                    else -> _anmeldeState.update {
                        it.copy(loginLaeuft = false, loginError = r.data.error ?: text(R.string.err_login_failed))
                    }
                }
                is Result.Error -> _anmeldeState.update { it.copy(loginLaeuft = false, loginError = meldung(r)) }
            }
        }
    }

    fun loginWithQrToken(serverUrl: String, token: String) {
        viewModelScope.launch {
            _anmeldeState.update { it.copy(loginLaeuft = true, loginError = null) }
            ablage.saveServerUrl(serverUrl.trim().trimEnd('/'))
            when (val r = admin.qrLogin(token)) {
                is Result.Success ->
                    if (r.data.success && r.data.token != null) {
                        angemeldet(r.data.token, r.data.user?.username ?: "", r.data.user?.isAdmin == true)
                        _anmeldeState.update { it.copy(loginLaeuft = false) }
                    } else qrGescheitert(r.data.error ?: text(R.string.err_qr_login_failed))
                is Result.Error -> qrGescheitert(meldung(r))
            }
        }
    }

    /** Ein zweiter QR-Anlauf nach einer gelungenen Anmeldung ist kein Fehler (siehe qrFehler). */
    private fun qrGescheitert(satz: String) {
        val schonAngemeldet = dienste.sitzung.state.value.isLoggedIn
        _anmeldeState.update { it.copy(loginLaeuft = false, loginError = qrFehler(schonAngemeldet, satz)) }
    }

    /**
     * Jede Anmeldung beginnt mit „alle Konten“ — VOR dem Token: Er stösst das
     * Laden von Konten und Filtern an, und das soll den geleerten Stand sehen.
     */
    private suspend fun angemeldet(token: String, benutzer: String, admin: Boolean) {
        dienste.blickfeld.anmeldungBeginnt()
        ablage.saveAuthToken(token)
        ablage.saveUsername(benutzer)
        dienste.sitzung.aendere { it.copy(isLoggedIn = true, isAdmin = admin) }
    }

    /** Ohne Antwort bleibt der Link verborgen: Ein Knopf ins Leere ist schlechter als keiner. */
    fun pruefeRegistrierungOffen() {
        viewModelScope.launch {
            when (val r = admin.getRegistrationStatus()) {
                is Result.Success -> _anmeldeState.update { it.copy(registrierungOffen = r.data.enabled) }
                is Result.Error -> Unit
            }
        }
    }

    fun zeigeAnmeldeFormular(formular: AnmeldeFormular) {
        // Meldung und Fehler gehen mit, sonst stünde die Bestätigung der
        // Registrierung noch im Formular „Passwort vergessen“.
        _anmeldeState.update { it.copy(formular = formular, meldung = null, fehler = null) }
    }

    fun registriere(username: String, email: String, vorname: String, nachname: String, passwort: String) {
        viewModelScope.launch {
            _anmeldeState.update { it.copy(laeuft = true, fehler = null, meldung = null) }
            val anfrage = RegisterRequest(
                username = username.trim(),
                email = email.trim(),
                firstName = vorname.trim().ifBlank { null },
                lastName = nachname.trim().ifBlank { null },
                password = passwort,
                // Die Sprache der Oberfläche steuert Bestätigungs-E-Mail und Kontoeinstellung.
                language = text(R.string.lang_code),
            )
            when (val r = admin.register(anfrage)) {
                is Result.Success ->
                    if (r.data.success) {
                        // Ohne Mailversand wartet man sonst auf eine E-Mail, die nie kommt.
                        val hinweis = if (r.data.consoleMode) " " + text(R.string.register_console_hint) else ""
                        _anmeldeState.update { it.copy(laeuft = false,
                            meldung = (r.data.message ?: text(R.string.register_done)) + hinweis) }
                    } else _anmeldeState.update { it.copy(laeuft = false, fehler = r.data.error ?: text(R.string.err_generic)) }
                is Result.Error -> _anmeldeState.update { it.copy(laeuft = false, fehler = meldung(r)) }
            }
        }
    }

    /**
     * Die Antwort des Servers ist absichtlich immer dieselbe; sie wird
     * unverändert gezeigt, sonst verriete die App, was der Server verschweigt.
     */
    fun passwortVergessen(email: String) {
        viewModelScope.launch {
            _anmeldeState.update { it.copy(laeuft = true, fehler = null, meldung = null) }
            when (val r = admin.forgotPassword(email.trim())) {
                is Result.Success -> _anmeldeState.update {
                    it.copy(laeuft = false, meldung = r.data.message ?: text(R.string.forgot_done))
                }
                is Result.Error -> _anmeldeState.update { it.copy(laeuft = false, fehler = meldung(r)) }
            }
        }
    }

    override fun zuruecksetzen() {
        _anmeldeState.value = AnmeldeUiState()
    }
}
