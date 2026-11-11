package ch.brickinventoryapp.anmeldung.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.model.data.model.RegisterRequest
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.model.data.model.TOKEN_SCOPE_APP
import ch.brickinventoryapp.model.data.model.TOKEN_SCOPE_VOLL
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.anmeldung.ui.AnmeldeFormular
import ch.brickinventoryapp.anmeldung.ui.AnmeldeUiState
import ch.brickinventoryapp.sitzung.qrFehler
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.sicherheit.bestaetigtFingerabdruck
import ch.brickinventoryapp.sicherheit.pinSchluessel
import ch.brickinventoryapp.sicherheit.SystemWurzeln
import ch.brickinventoryapp.sicherheit.RpIdBefund
import ch.brickinventoryapp.sicherheit.hostVon
import ch.brickinventoryapp.sicherheit.pruefeRpId
import kotlinx.serialization.json.Json
import ch.brickinventoryapp.model.data.model.LoginResponse
import ch.brickinventoryapp.model.data.model.PASSKEY_ANMELDEN
import ch.brickinventoryapp.model.data.model.PASSKEY_ZWEITER_FAKTOR
import ch.brickinventoryapp.anmeldung.ui.PasskeyAbfrage
import ch.brickinventoryapp.anmeldung.ui.PasskeyErgebnis
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ch.brickinventoryapp.model.data.model.QrAbholung
import ch.brickinventoryapp.model.data.model.QrMeldung
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.anmeldung.ui.QrKonto
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.sitzung.SitzungsRepository
import ch.brickinventoryapp.zustand.ui.Blickfeld
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung

/** So oft fragt die App nach dem QR-Scan, ob der Browser die Kopplung bestätigt hat. */
internal const val QR_ABFRAGE_MS = 2_000L

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
    internal val anmeldeState: StateFlow<AnmeldeUiState> = _anmeldeState.asStateFlow()

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
    internal fun passkeyStattCode(username: String, password: String, abfrage: PasskeyAbfrage) {
        viewModelScope.launch {
            mitPasswort(username, password, null) { holePasskey(PASSKEY_ZWEITER_FAKTOR, abfrage) }
        }
    }

    /** Ohne Passwort: Der Credential Manager bietet die Passkeys dieses Servers an. */
    internal fun passkeyAnmelden(abfrage: PasskeyAbfrage) {
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
     */
    fun loginWithQrToken(
        serverUrl: String, token: String, fingerabdruck: String? = null,
        pinWechselEingabe: String? = null, geraet: String = "Android App",
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
                when (val r = konto.qrLogin(token, geraet)) {
                    is Ergebnis.Success -> koppleQr(r.data, schluessel, fingerabdruck)
                    is Ergebnis.Error -> qrGescheitert(meldungen.meldung(r))
                }
            } finally {
                // Nach merkePin ein No-op; sonst bleibt nichts vom Code zurück.
                if (schluessel != null) ablage.vergissVorgehaltenen(schluessel)
            }
        }
    }

    /** Wartet die Kopplung auf das Ja oder Nein zum gezeigten Konto ([AnmeldeUiState.qrKonto]). */
    private var qrEntscheidung: CompletableDeferred<Boolean>? = null

    /** Das Ja oder Nein zum Konto, das der Server nach der Bestätigung im Browser nennt. */
    fun qrKontoEntscheiden(uebernehmen: Boolean) {
        qrEntscheidung?.complete(uebernehmen)
    }

    /**
     * Der Pin wird erst gemerkt, wenn der Browser die Kopplung bestätigt und man das
     * gezeigte Konto angenommen hat: Ein abgelehnter, verfallener oder untergeschobener
     * Code darf keinen Schlüssel und keinen Token zurücklassen. Das Warten auf das Ja
     * bleibt in dieser Koroutine, damit der vorgehaltene Pin bis zur Abholung gilt.
     */
    private suspend fun koppleQr(antwort: QrMeldung, schluessel: String?, fingerabdruck: String?) {
        val abholung = antwort.abholung
        val code = antwort.code
        if (!antwort.success || abholung == null || code == null) {
            qrGescheitert(antwort.error ?: meldungen.text(R.string.err_qr_login_failed))
            return
        }
        _anmeldeState.update { it.copy(qrBestaetigung = code) }
        val vorschau = warteAufBestaetigung(abholung, antwort.expiresIn) ?: return
        val benutzer = vorschau.username ?: vorschau.user?.username
        if (benutzer.isNullOrBlank()) {
            qrGescheitert(meldungen.text(R.string.err_qr_login_failed))
            return
        }
        if (!frageNachKonto(QrKonto(benutzer, ablage.serverUrlJetzt()))) {
            konto.qrVerwerfen(abholung)
            _anmeldeState.update { it.copy(loginLaeuft = false) }
            return
        }
        val neuesToken = vorschau.token ?: holeQrToken(abholung) ?: return
        if (schluessel != null && fingerabdruck != null) ablage.merkePin(schluessel, fingerabdruck)
        angemeldet(neuesToken, benutzer, false)
        _anmeldeState.update { it.copy(loginLaeuft = false) }
    }

    private suspend fun frageNachKonto(gezeigt: QrKonto): Boolean {
        val entscheidung = CompletableDeferred<Boolean>().also { qrEntscheidung = it }
        _anmeldeState.update { it.copy(qrBestaetigung = null, qrKonto = gezeigt) }
        return try {
            entscheidung.await()
        } finally {
            qrEntscheidung = null
            _anmeldeState.update { it.copy(qrKonto = null) }
        }
    }

    private suspend fun holeQrToken(abholung: String): String? {
        val satz = when (val r = konto.qrAbholen(abholung)) {
            is Ergebnis.Success -> r.data.token?.let { return it } ?: r.data.error ?: meldungen.text(R.string.err_qr_login_failed)
            is Ergebnis.Error -> meldungen.meldung(r)
        }
        qrGescheitert(satz)
        return null
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

    /**
     * Fragt, bis der Browser die Kopplung bestätigt oder ablehnt; null heisst gescheitert,
     * der Zustand sagt dann schon, warum. Nach der Frist des Codes fragt die App nicht weiter.
     */
    private suspend fun warteAufBestaetigung(abholung: String, sekunden: Int): QrAbholung? {
        val ende = System.currentTimeMillis() + sekunden * 1000L
        while (System.currentTimeMillis() < ende) {
            when (val r = konto.qrAbholen(abholung, vorschau = true)) {
                is Ergebnis.Success -> if (r.data.vorschau || r.data.token != null) return r.data
                    else if (!r.data.wartet) return qrGescheitert(r.data.error ?: meldungen.text(R.string.err_qr_login_failed))
                is Ergebnis.Error -> return qrGescheitert(meldungen.meldung(r))
            }
            delay(QR_ABFRAGE_MS)
        }
        return qrGescheitert(meldungen.text(R.string.err_qr_login_failed))
    }

    /** Ein zweiter QR-Anlauf nach einer gelungenen Anmeldung ist kein Fehler (siehe qrFehler). */
    private fun qrGescheitert(satz: String): QrAbholung? {
        val schonAngemeldet = sitzung.state.value.isLoggedIn
        _anmeldeState.update { it.copy(loginLaeuft = false, qrBestaetigung = null, qrKonto = null,
            loginError = qrFehler(schonAngemeldet, satz)) }
        return null
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
