package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.Netzkennung
import ch.brickinventoryapp.data.model.RegisterRequest
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.model.TOKEN_SCOPE_APP
import ch.brickinventoryapp.data.model.TOKEN_SCOPE_VOLL
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.AnmeldeUiState
import ch.brickinventoryapp.ui.qrFehler
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.pinSchluessel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Server einrichten, anmelden (Passwort, zweiter Faktor, QR), Konto anlegen,
 * Passwort vergessen. An die Activity gebunden, weil der QR-Weg die Einrichtung
 * verlässt, während die Anmeldung noch läuft.
 */
@HiltViewModel
class AnmeldungViewModel @Inject constructor(
    dienste: AppDienste,
    private val konto: KontoRepository,
    private val ablage: Anmeldeablage,
    private val netzkennung: Netzkennung,
) : BereichsViewModel(dienste) {

    private val _anmeldeState = MutableStateFlow(AnmeldeUiState())
    val anmeldeState: StateFlow<AnmeldeUiState> = _anmeldeState.asStateFlow()

    /**
     * Zuerst die Erlaubnis für Klartext, dann die Adresse: Die ersten Anfragen folgen
     * sofort. Ein anderer Server meldet vorher ganz ab ([abmelden], der Weg der App),
     * denn der Token gehört dem alten. Das Netz der Einrichtung gilt als bekannt.
     */
    fun saveServerUrl(url: String, klartextBestaetigt: Boolean = false, abmelden: suspend () -> Unit = {}) {
        viewModelScope.launch { richteEin(url, klartextBestaetigt, abmelden) }
    }

    private suspend fun richteEin(url: String, klartextBestaetigt: Boolean, abmelden: suspend () -> Unit) {
        val neu = url.trim().trimEnd('/')
        if (dienste.sitzung.state.value.isLoggedIn && !NetworkPolicy.gleicheHerkunft(ablage.serverUrlJetzt(), neu)) {
            abmelden()
        }
        if (klartextBestaetigt) NetworkPolicy.klartextHost(neu)?.let { ablage.bestaetigeKlartext(it) }
        ablage.saveServerUrl(neu)
        netzkennung.fingerabdruck()?.let { ablage.merkeNetz(NetworkPolicy.netzEintrag(neu, it)) }
    }

    /**
     * [netzBestaetigt]: Der Nutzer hat die Rückfrage „anderes Netz, Passwort im
     * Klartext“ ausdrücklich bejaht; das Netz gilt danach als bekannt.
     */
    fun login(username: String, password: String, code: String? = null, netzBestaetigt: Boolean = false) {
        viewModelScope.launch {
            val url = ablage.serverUrlJetzt()
            val netz = netzkennung.fingerabdruck()
            if (NetworkPolicy.anmeldungBrauchtNetzBestaetigung(url, netz, ablage.bekannteNetze())) {
                if (!netzBestaetigt) {
                    _anmeldeState.update { it.copy(netzFrage = true) }
                    return@launch
                }
                netz?.let { ablage.merkeNetz(NetworkPolicy.netzEintrag(url, it)) }
            }
            _anmeldeState.update { it.copy(netzFrage = false, loginLaeuft = true, loginError = null) }
            val scope = if (_anmeldeState.value.vollerZugriff) TOKEN_SCOPE_VOLL else TOKEN_SCOPE_APP
            when (val r = konto.login(url, username, password, code?.trim()?.takeIf { it.isNotEmpty() }, scope)) {
                is Result.Success -> when {
                    // Erstes Mal nur das Codefeld zeigen; mit Code den Satz des Servers.
                    r.data.zweiterFaktor -> _anmeldeState.update { it.copy(codeNoetig = true, loginLaeuft = false,
                        loginError = if (code.isNullOrBlank()) null else r.data.error) }
                    r.data.success && r.data.token != null -> {
                        angemeldet(r.data.token, r.data.user?.username ?: username, r.data.verwalter)
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

    /** Das Häkchen „mit Verwalterrechten“ im Anmeldeformular. */
    fun setzeVollerZugriff(an: Boolean) = _anmeldeState.update { it.copy(vollerZugriff = an) }

    /** Die Rückfrage verneint: Es geht nichts hinaus. */
    fun netzFrageVerwerfen() {
        _anmeldeState.update { it.copy(netzFrage = false) }
    }

    /**
     * Erst nach der Bestätigung im Einrichtungsbildschirm: Die Adresse kommt aus dem
     * Code. Trägt er einen Fingerabdruck, gilt der Pin schon für die erste Anfrage.
     */
    fun loginWithQrToken(
        serverUrl: String, token: String, klartextBestaetigt: Boolean = false,
        abmelden: suspend () -> Unit = {}, fingerabdruck: String? = null,
    ) {
        viewModelScope.launch {
            _anmeldeState.update { it.copy(loginLaeuft = true, loginError = null) }
            if (fingerabdruck != null) pinSchluessel(serverUrl)?.let { ablage.merkePin(it, fingerabdruck) }
            richteEin(serverUrl, klartextBestaetigt, abmelden)
            when (val r = konto.qrLogin(token)) {
                is Result.Success ->
                    if (r.data.success && r.data.token != null) {
                        angemeldet(r.data.token, r.data.user?.username ?: "", r.data.verwalter)
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
            when (val r = konto.getRegistrationStatus()) {
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
            when (val r = konto.register(anfrage)) {
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
            when (val r = konto.forgotPassword(email.trim())) {
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
