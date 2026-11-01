package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
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
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.model.LoginResponse
import ch.brickinventoryapp.data.model.PASSKEY_ANMELDEN
import ch.brickinventoryapp.data.model.PASSKEY_ZWEITER_FAKTOR
import ch.brickinventoryapp.ui.PasskeyAbfrage
import ch.brickinventoryapp.ui.PasskeyErgebnis
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Server einrichten, anmelden (Passwort, zweiter Faktor, Passkey, QR), Konto anlegen,
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
        viewModelScope.launch { mitPasswort(username, password, code, netzBestaetigt) }
    }

    /** Der Passkey ersetzt den Code des zweiten Faktors; Name und Passwort gehen mit. */
    fun passkeyStattCode(username: String, password: String, abfrage: PasskeyAbfrage, netzBestaetigt: Boolean = false) {
        viewModelScope.launch {
            mitPasswort(username, password, null, netzBestaetigt) { holePasskey(PASSKEY_ZWEITER_FAKTOR, abfrage) }
        }
    }

    /** Ohne Passwort: Der Credential Manager bietet die Passkeys dieses Servers an. */
    fun passkeyAnmelden(abfrage: PasskeyAbfrage) {
        viewModelScope.launch {
            _anmeldeState.update { it.copy(loginLaeuft = true, loginError = null) }
            val antwort = holePasskey(PASSKEY_ANMELDEN, abfrage) ?: return@launch
            when (val r = konto.passkeyAnmelden(ablage.serverUrlJetzt(), antwort, scope())) {
                is Result.Success -> nachAntwort(r.data, "", mitCode = false)
                is Result.Error -> _anmeldeState.update { it.copy(loginLaeuft = false, loginError = meldung(r)) }
            }
        }
    }

    /**
     * Das Passwort geht erst nach der Netzprüfung hinaus. [passkey] läuft danach:
     * Ein abgebrochener Dialog soll keine halbe Anmeldung hinterlassen.
     */
    private suspend fun mitPasswort(username: String, password: String, code: String?, netzBestaetigt: Boolean,
                                    passkey: (suspend () -> JsonObject?)? = null) {
        val url = ablage.serverUrlJetzt()
        val netz = netzkennung.fingerabdruck()
        if (NetworkPolicy.anmeldungBrauchtNetzBestaetigung(url, netz, ablage.bekannteNetze())) {
            if (!netzBestaetigt) {
                _anmeldeState.update { it.copy(netzFrage = true) }
                return
            }
            netz?.let { ablage.merkeNetz(NetworkPolicy.netzEintrag(url, it)) }
        }
        _anmeldeState.update { it.copy(netzFrage = false, loginLaeuft = true, loginError = null) }
        val antwort = passkey?.let { it() ?: return }
        val mitCode = !code.isNullOrBlank() || antwort != null
        when (val r = konto.login(url, username, password, code?.trim()?.takeIf { it.isNotEmpty() }, scope(), antwort)) {
            is Result.Success -> {
                if (r.data.antwort.zweiterFaktor)
                    _anmeldeState.update { it.copy(passkeyStattCode = r.data.passkeyStattCode) }
                nachAntwort(r.data.antwort, username, mitCode)
            }
            is Result.Error -> _anmeldeState.update { it.copy(loginLaeuft = false, loginError = meldung(r)) }
        }
    }

    /** [mitCode]: Ein zweiter Faktor wurde mitgeschickt; dann ist ein Nein des Servers ein Fehler. */
    private suspend fun nachAntwort(antwort: LoginResponse, benutzer: String, mitCode: Boolean) {
        // In eine lokale Variable: Das Modell liegt in core-model, über die
        // Modulgrenze prüft Kotlin `!= null` nicht für den Aufruf darunter.
        val neuesToken = antwort.token
        when {
            antwort.zweiterFaktor -> _anmeldeState.update { it.copy(codeNoetig = true, loginLaeuft = false,
                loginError = if (mitCode) antwort.error else null) }
            antwort.success && neuesToken != null -> {
                angemeldet(neuesToken, antwort.user?.username ?: benutzer, antwort.verwalter)
                _anmeldeState.update { it.copy(codeNoetig = false, passkeyStattCode = false, loginLaeuft = false) }
            }
            else -> _anmeldeState.update {
                it.copy(loginLaeuft = false, loginError = antwort.error ?: text(R.string.err_login_failed))
            }
        }
    }

    /** null, wenn es nicht weitergeht; der Zustand sagt dann schon, warum. */
    private suspend fun holePasskey(zweck: String, abfrage: PasskeyAbfrage): JsonObject? {
        _anmeldeState.update { it.copy(loginLaeuft = true, loginError = null) }
        val optionen = when (val o = konto.passkeyOptionen(zweck)) {
            is Result.Success -> o.data.optionen ?: return passkeyGescheitert(o.data.error ?: text(R.string.login_passkey_fehler))
            is Result.Error -> return passkeyGescheitert(meldung(o))
        }
        return when (val e = abfrage.hole(optionen.toString())) {
            is PasskeyErgebnis.Antwort -> runCatching { ApiJson.parseToJsonElement(e.json).jsonObject }.getOrNull()
                ?: passkeyGescheitert(text(R.string.login_passkey_fehler))
            PasskeyErgebnis.Abgebrochen -> passkeyGescheitert(null)
            PasskeyErgebnis.KeinPasskey -> passkeyGescheitert(text(R.string.login_passkey_keiner))
            is PasskeyErgebnis.Fehler -> passkeyGescheitert(text(R.string.login_passkey_fehler))
        }
    }

    private fun passkeyGescheitert(satz: String?): JsonObject? {
        _anmeldeState.update { it.copy(loginLaeuft = false, loginError = satz) }
        return null
    }

    private fun scope() = if (_anmeldeState.value.vollerZugriff) TOKEN_SCOPE_VOLL else TOKEN_SCOPE_APP

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
                is Result.Success -> {
                    val neuesToken = r.data.token
                    if (r.data.success && neuesToken != null) {
                        angemeldet(neuesToken, r.data.user?.username ?: "", r.data.verwalter)
                        _anmeldeState.update { it.copy(loginLaeuft = false) }
                    } else qrGescheitert(r.data.error ?: text(R.string.err_qr_login_failed))
                }
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
