package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.model.RegisterRequest
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.model.TOKEN_SCOPE_APP
import ch.brickinventoryapp.data.model.TOKEN_SCOPE_VOLL
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.AnmeldeUiState
import ch.brickinventoryapp.ui.qrFehler
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.bestaetigtFingerabdruck
import ch.brickinventoryapp.util.pinSchluessel
import ch.brickinventoryapp.util.SystemWurzeln
import ch.brickinventoryapp.util.RpIdBefund
import ch.brickinventoryapp.util.hostVon
import ch.brickinventoryapp.util.pruefeRpId
import kotlinx.serialization.json.Json
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
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.ui.AppUiState
import ch.brickinventoryapp.ui.Sitzung
import ch.brickinventoryapp.ui.SitzungsRepository
import ch.brickinventoryapp.ui.Blickfeld

/**
 * Server einrichten, anmelden (Passwort, zweiter Faktor, Passkey, QR), Konto anlegen,
 * Passwort vergessen. An die Activity gebunden, weil der QR-Weg die Einrichtung
 * verlässt, während die Anmeldung noch läuft.
 */
@HiltViewModel
class AnmeldungViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val blickfeldDienst: Blickfeld,
    private val meldungen: Meldungen,
    private val sitzungsDienst: SitzungsRepository,
    private val konto: KontoRepository,
    private val ablage: Anmeldeablage,
    private val systemWurzeln: SystemWurzeln,
) : ViewModel() {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
    }

    private val _anmeldeState = MutableStateFlow(AnmeldeUiState())
    val anmeldeState: StateFlow<AnmeldeUiState> = _anmeldeState.asStateFlow()

    /**
     * Nur eine https-Adresse wird gespeichert; false heisst abgelehnt, die
     * Einrichtung bleibt stehen. Ein anderer Server meldet vorher ganz ab
     * (über den SitzungsDienst, den Weg der App), denn der Token gehört dem alten.
     */
    fun saveServerUrl(url: String): Boolean {
        val neu = NetworkPolicy.normalisiere(url)
        if (NetworkPolicy.adressfehler(neu, NetworkPolicy.entwicklung) != null) return false
        viewModelScope.launch { richteEin(neu) }
        return true
    }

    private suspend fun richteEin(neu: String) {
        if (sitzung.state.value.isLoggedIn && !NetworkPolicy.gleicherServer(ablage.serverUrlJetzt(), neu)) {
            sitzungsDienst.abmelden().join()
        }
        ablage.saveServerUrl(neu)
    }

    fun login(username: String, password: String, code: String? = null) {
        viewModelScope.launch { mitPasswort(username, password, code) }
    }

    /** Der Passkey ersetzt den Code des zweiten Faktors; Name und Passwort gehen mit. */
    fun passkeyStattCode(username: String, password: String, abfrage: PasskeyAbfrage) {
        viewModelScope.launch {
            mitPasswort(username, password, null) { holePasskey(PASSKEY_ZWEITER_FAKTOR, abfrage) }
        }
    }

    /** Ohne Passwort: Der Credential Manager bietet die Passkeys dieses Servers an. */
    fun passkeyAnmelden(abfrage: PasskeyAbfrage) {
        viewModelScope.launch {
            _anmeldeState.update { it.copy(loginLaeuft = true, loginError = null) }
            val antwort = holePasskey(PASSKEY_ANMELDEN, abfrage) ?: return@launch
            when (val r = konto.passkeyAnmelden(ablage.serverUrlJetzt(), antwort, scope())) {
                is Ergebnis.Success -> nachAntwort(r.data, "", mitCode = false)
                is Ergebnis.Error -> _anmeldeState.update { it.copy(loginLaeuft = false, loginError = meldungen.meldung(r)) }
            }
        }
    }

    /** [passkey] läuft vor dem Senden: Ein abgebrochener Dialog soll keine halbe Anmeldung hinterlassen. */
    private suspend fun mitPasswort(username: String, password: String, code: String?,
                                    passkey: (suspend () -> JsonObject?)? = null) {
        val url = ablage.serverUrlJetzt()
        _anmeldeState.update { it.copy(loginLaeuft = true, loginError = null) }
        val antwort = passkey?.let { it() ?: return }
        val mitCode = !code.isNullOrBlank() || antwort != null
        when (val r = konto.login(url, username, password, code?.trim()?.takeIf { it.isNotEmpty() }, scope(), antwort)) {
            is Ergebnis.Success -> {
                if (r.data.antwort.zweiterFaktor)
                    _anmeldeState.update { it.copy(passkeyStattCode = r.data.passkeyStattCode) }
                nachAntwort(r.data.antwort, username, mitCode)
            }
            is Ergebnis.Error -> _anmeldeState.update { it.copy(loginLaeuft = false, loginError = meldungen.meldung(r)) }
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
                it.copy(loginLaeuft = false, loginError = antwort.error ?: meldungen.text(R.string.err_login_failed))
            }
        }
    }

    /**
     * null, wenn es nicht weitergeht; der Zustand sagt dann schon, warum. Die
     * rpId muss der Host der eingerichteten Adresse sein (util/PasskeyHerkunft),
     * und die Adresse darf sich bis zur Antwort nicht ändern: Sonst ginge die
     * Signatur an einen anderen Server als den, dessen Optionen geprüft wurden.
     */
    private suspend fun holePasskey(zweck: String, abfrage: PasskeyAbfrage): JsonObject? {
        _anmeldeState.update { it.copy(loginLaeuft = true, loginError = null) }
        val adresse = ablage.serverUrlJetzt()
        val optionen = when (val o = konto.passkeyOptionen(zweck)) {
            is Ergebnis.Success -> o.data.optionen ?: return passkeyGescheitert(o.data.error ?: meldungen.text(R.string.login_passkey_fehler))
            is Ergebnis.Error -> return passkeyGescheitert(meldungen.meldung(o))
        }
        if (ablage.serverUrlJetzt() != adresse) return passkeyGescheitert(meldungen.text(R.string.login_passkey_fehler))
        when (pruefeRpId(optionen, adresse)) {
            RpIdBefund.PASST -> Unit
            RpIdBefund.FEHLT -> return passkeyGescheitert(meldungen.text(R.string.login_passkey_rpid_fehlt))
            RpIdBefund.FREMD -> return passkeyGescheitert(meldungen.text(R.string.login_passkey_rpid_fremd, hostVon(adresse)))
        }
        val ergebnis = abfrage.hole(optionen.toString())
        if (ablage.serverUrlJetzt() != adresse) return passkeyGescheitert(meldungen.text(R.string.login_passkey_fehler))
        return when (val e = ergebnis) {
            is PasskeyErgebnis.Antwort -> runCatching { Json.parseToJsonElement(e.json).jsonObject }.getOrNull()
                ?: passkeyGescheitert(meldungen.text(R.string.login_passkey_fehler))
            PasskeyErgebnis.Abgebrochen -> passkeyGescheitert(null)
            PasskeyErgebnis.KeinPasskey -> passkeyGescheitert(meldungen.text(R.string.login_passkey_keiner))
            is PasskeyErgebnis.Fehler -> passkeyGescheitert(meldungen.text(R.string.login_passkey_fehler))
        }
    }

    private fun passkeyGescheitert(satz: String?): JsonObject? {
        _anmeldeState.update { it.copy(loginLaeuft = false, loginError = satz) }
        return null
    }

    private fun scope() = if (_anmeldeState.value.vollerZugriff) TOKEN_SCOPE_VOLL else TOKEN_SCOPE_APP

    /** Das Häkchen „mit Verwalterrechten“ im Anmeldeformular. */
    fun setzeVollerZugriff(an: Boolean) = _anmeldeState.update { it.copy(vollerZugriff = an) }

    /**
     * Erst nach der Bestätigung im Einrichtungsbildschirm: Die Adresse kommt aus dem Code.
     * Sein Fingerabdruck gilt schon für die erste Anfrage, gemerkt wird er aber erst nach
     * gelungener Anmeldung.
     * Ausführlich: docs/begruendungen/feature-anmeldung/ui/viewmodel/AnmeldungViewModel.kt.md#loginwithqrtoken
     */
    fun loginWithQrToken(
        serverUrl: String, token: String, fingerabdruck: String? = null,
        pinWechselEingabe: String? = null,
    ) {
        val neu = NetworkPolicy.normalisiere(serverUrl)
        qrAbgelehnt(serverUrl, neu, fingerabdruck, pinWechselEingabe)?.let { satz ->
            _anmeldeState.update { it.copy(loginLaeuft = false, loginError = meldungen.text(satz)) }
            return
        }
        val schluessel = if (fingerabdruck != null) pinSchluessel(neu) else null
        viewModelScope.launch {
            _anmeldeState.update { it.copy(loginLaeuft = true, loginError = null) }
            if (schluessel != null && fingerabdruck != null) ablage.halteVor(schluessel, fingerabdruck)
            try {
                richteEin(neu)
                when (val r = konto.qrLogin(token)) {
                    is Ergebnis.Success -> {
                        val neuesToken = r.data.token
                        if (r.data.success && neuesToken != null) {
                            if (schluessel != null && fingerabdruck != null) ablage.merkePin(schluessel, fingerabdruck)
                            angemeldet(neuesToken, r.data.user?.username ?: "", r.data.verwalter)
                            _anmeldeState.update { it.copy(loginLaeuft = false) }
                        } else qrGescheitert(r.data.error ?: meldungen.text(R.string.err_qr_login_failed))
                    }
                    is Ergebnis.Error -> qrGescheitert(meldungen.meldung(r))
                }
            } finally {
                // Nach merkePin ein No-op; sonst bleibt nichts vom Code zurück.
                if (schluessel != null) ablage.vergissVorgehaltenen(schluessel)
            }
        }
    }

    /**
     * Warum der Code nicht angenommen wird, als Satz; null, wenn er gilt. Ein fremder
     * Schlüssel aus dem Code gilt nur abgetippt (mussAbtippen), sonst bliebe der Pin
     * des Angreifers gemerkt.
     */
    private fun qrAbgelehnt(serverUrl: String, neu: String, fingerabdruck: String?, eingabe: String?): Int? {
        when (NetworkPolicy.adressfehler(serverUrl, NetworkPolicy.entwicklung)) {
            null -> Unit
            NetworkPolicy.Adressfehler.KLARTEXT -> return R.string.setup_qr_klartext_abgelehnt
            else -> return R.string.setup_invalid_qr
        }
        if (fingerabdruck == null || pinSchluessel(neu) == null || !mussAbtippen(neu, fingerabdruck) ||
            bestaetigtFingerabdruck(eingabe, fingerabdruck)) return null
        return if (bisherigerPin(neu, fingerabdruck) != null) R.string.setup_qr_pin_wechsel_abgelehnt
            else R.string.setup_qr_pin_abtippen_abgelehnt
    }

    /**
     * Der gemerkte Pin für die Adresse, wenn er von [fingerabdruck] abweicht —
     * dann fragt der Einrichtungsbildschirm nach (bisher/neu), bevor er anmeldet.
     */
    fun bisherigerPin(serverUrl: String, fingerabdruck: String?): String? {
        if (fingerabdruck == null) return null
        val schluessel = pinSchluessel(NetworkPolicy.normalisiere(serverUrl)) ?: return null
        return ablage.gemerkterPin(schluessel)?.takeIf { it != fingerabdruck }
    }

    /**
     * Muss der Fingerabdruck des Codes aus der Webapp abgetippt werden? Ohne Abtippen
     * gilt nur der schon bestätigte Pin oder eine System-Wurzel: Deren Kette muss
     * ohnehin öffentlich gültig sein, ein fremder Schlüssel aus dem Code nicht.
     */
    fun mussAbtippen(serverUrl: String, fingerabdruck: String?): Boolean {
        if (fingerabdruck == null) return false
        val schluessel = pinSchluessel(NetworkPolicy.normalisiere(serverUrl)) ?: return false
        val gemerkt = ablage.gemerkterPin(schluessel)
        return if (gemerkt != null) gemerkt != fingerabdruck else !systemWurzeln.enthaelt(fingerabdruck)
    }

    /** Ein zweiter QR-Anlauf nach einer gelungenen Anmeldung ist kein Fehler (siehe qrFehler). */
    private fun qrGescheitert(satz: String) {
        val schonAngemeldet = sitzung.state.value.isLoggedIn
        _anmeldeState.update { it.copy(loginLaeuft = false, loginError = qrFehler(schonAngemeldet, satz)) }
    }

    /**
     * Jede Anmeldung beginnt mit „alle Konten“ — VOR dem Token: Er stösst das
     * Laden von Konten und Filtern an, und das soll den geleerten Stand sehen.
     */
    private suspend fun angemeldet(token: String, benutzer: String, admin: Boolean) {
        blickfeldDienst.anmeldungBeginnt()
        ablage.saveAuthToken(token)
        ablage.saveUsername(benutzer)
        sitzung.angemeldet(admin)
    }

    /** Ohne Antwort bleibt der Link verborgen: Ein Knopf ins Leere ist schlechter als keiner. */
    fun pruefeRegistrierungOffen() {
        viewModelScope.launch {
            when (val r = konto.getRegistrationStatus()) {
                is Ergebnis.Success -> _anmeldeState.update { it.copy(registrierungOffen = r.data.enabled) }
                is Ergebnis.Error -> Unit
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
                language = meldungen.text(R.string.lang_code),
            )
            when (val r = konto.register(anfrage)) {
                is Ergebnis.Success ->
                    if (r.data.success) {
                        // Ohne Mailversand wartet man sonst auf eine E-Mail, die nie kommt.
                        val hinweis = if (r.data.consoleMode) " " + meldungen.text(R.string.register_console_hint) else ""
                        _anmeldeState.update { it.copy(laeuft = false,
                            meldung = (r.data.message ?: meldungen.text(R.string.register_done)) + hinweis) }
                    } else _anmeldeState.update { it.copy(laeuft = false, fehler = r.data.error ?: meldungen.text(R.string.err_generic)) }
                is Ergebnis.Error -> _anmeldeState.update { it.copy(laeuft = false, fehler = meldungen.meldung(r)) }
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
                is Ergebnis.Success -> _anmeldeState.update {
                    it.copy(laeuft = false, meldung = r.data.message ?: meldungen.text(R.string.forgot_done))
                }
                is Ergebnis.Error -> _anmeldeState.update { it.copy(laeuft = false, fehler = meldungen.meldung(r)) }
            }
        }
    }

    private fun zuruecksetzen() {
        _anmeldeState.value = AnmeldeUiState()
    }
}
