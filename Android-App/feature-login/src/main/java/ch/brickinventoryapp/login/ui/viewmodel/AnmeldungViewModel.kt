package ch.brickinventoryapp.login.ui.viewmodel

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.beendet
import ch.brickinventoryapp.model.ui.withoutError
import ch.brickinventoryapp.state.ui.gescheitert
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.model.ui.Meldung
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.model.domain.Anmeldung
import ch.brickinventoryapp.model.domain.Kontoanlage
import ch.brickinventoryapp.model.domain.QrAbholstand
import ch.brickinventoryapp.model.domain.QrPairing
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_APP
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_FULL
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.login.ui.LoginUiState
import ch.brickinventoryapp.session.qrError
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.Transcript
import ch.brickinventoryapp.security.pinKey
import ch.brickinventoryapp.security.SystemRoots
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.RpIdFinding
import ch.brickinventoryapp.security.hostOf
import ch.brickinventoryapp.security.checkRpId
import kotlinx.serialization.json.Json
import ch.brickinventoryapp.model.domain.PASSKEY_SIGN_IN
import ch.brickinventoryapp.model.domain.PASSKEY_SECOND_FACTOR
import ch.brickinventoryapp.login.ui.PasskeyQuery
import ch.brickinventoryapp.login.ui.PasskeyResult
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.login.ui.QrAccount
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.session.SitzungsRepository
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut

/** So oft fragt die App nach dem QR-Scan, ob der Browser die Kopplung bestätigt hat. */
internal const val QR_QUERY_MS = 2_000L

/**
 * Server einrichten, anmelden (Passwort, zweiter Faktor, Passkey, QR), Konto anlegen,
 * Passwort vergessen. An die Activity gebunden, weil der QR-Weg die Einrichtung
 * verlässt, während die Anmeldung noch läuft.
 */
@HiltViewModel
class AnmeldungViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val scopeService: Scope,
    private val meldungen: Meldungen,
    private val sessionService: SitzungsRepository,
    private val konto: AccountRepository,
    private val ablage: Anmeldeablage,
    private val frage: CertificateQuestion,
    private val systemRoots: SystemRoots,
) : ViewModel() {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        sequenceSignOut(sitzung) { reset() }
    }

    private val _loginState = MutableStateFlow(LoginUiState())
    internal val anmeldeState: StateFlow<LoginUiState> = _loginState.asStateFlow()

    /**
     * Nur eine https-Adresse wird gespeichert; false heisst abgelehnt, die
     * Einrichtung bleibt stehen. Ein anderer Server meldet vorher ganz ab
     * (über den SitzungsDienst, den Weg der App), denn der Token gehört dem alten.
     */
    fun saveServerUrl(url: String): Boolean {
        val neu = NetworkPolicy.normalize(url)
        if (NetworkPolicy.addressError(neu, NetworkPolicy.entwicklung) != null) return false
        viewModelScope.launch { setUpOne(neu) }
        return true
    }

    private suspend fun setUpOne(neu: String) {
        if (sitzung.state.value.isLoggedIn && !NetworkPolicy.sameServer(ablage.serverUrlJetzt(), neu)) {
            sessionService.abmelden().join()
        }
        ablage.saveServerUrl(neu)
    }

    fun login(username: String, password: String, code: String? = null) {
        viewModelScope.launch { withPassword(username, password, code) }
    }

    /** Der Passkey ersetzt den Code des zweiten Faktors; Name und Passwort gehen mit. */
    internal fun passkeyStattCode(username: String, password: String, abfrage: PasskeyQuery) {
        viewModelScope.launch {
            withPassword(username, password, null) { fetchPasskey(PASSKEY_SECOND_FACTOR, abfrage) }
        }
    }

    /** Ohne Passwort: Der Credential Manager bietet die Passkeys dieses Servers an. */
    internal fun signInPasskey(abfrage: PasskeyQuery) {
        viewModelScope.launch {
            _loginState.update { it.copy(anmeldung = Vorgang.Laeuft) }
            val antwort = fetchPasskey(PASSKEY_SIGN_IN, abfrage) ?: return@launch
            when (val r = konto.signInPasskey(ablage.serverUrlJetzt(), antwort, scope())) {
                is Ergebnis.Erfolg -> afterResponse(r.data, "", withCode = false)
                is Ergebnis.Fehler -> _loginState.update { it.copy(anmeldung = gescheitert(r)) }
            }
        }
    }

    /** [passkey] läuft vor dem Senden: Ein abgebrochener Dialog soll keine halbe Anmeldung hinterlassen. */
    private suspend fun withPassword(username: String, password: String, code: String?,
                                    passkey: (suspend () -> JsonObject?)? = null) {
        val url = ablage.serverUrlJetzt()
        _loginState.update { it.copy(anmeldung = Vorgang.Laeuft) }
        val antwort = passkey?.let { it() ?: return }
        val withCode = !code.isNullOrBlank() || antwort != null
        when (val r = konto.login(url, username, password, code?.trim()?.takeIf { it.isNotEmpty() }, scope(), antwort)) {
            is Ergebnis.Erfolg -> {
                if (r.data.antwort.zweiterFaktor)
                    _loginState.update { it.copy(passkeyStattCode = r.data.passkeyStattCode) }
                afterResponse(r.data.antwort, username, withCode)
            }
            is Ergebnis.Fehler -> _loginState.update { it.copy(anmeldung = gescheitert(r)) }
        }
    }

    /** [withCode]: Ein zweiter Faktor wurde mitgeschickt; dann ist ein Nein des Servers ein Fehler. */
    private suspend fun afterResponse(antwort: Anmeldung, benutzer: String, withCode: Boolean) {
        // In eine lokale Variable: Das Modell liegt in core-model, über die
        // Modulgrenze prüft Kotlin `!= null` nicht für den Aufruf darunter.
        val newToken = antwort.token
        when {
            antwort.zweiterFaktor -> _loginState.update { it.copy(codeNoetig = true,
                anmeldung = beendet(if (withCode) antwort.fehler?.let(Meldung::Text) else null)) }
            antwort.erfolg && newToken != null -> {
                angemeldet(newToken, antwort.benutzer ?: benutzer, antwort.verwalter)
                _loginState.update { it.copy(codeNoetig = false, passkeyStattCode = false, anmeldung = Vorgang.Fertig) }
            }
            else -> _loginState.update {
                it.copy(anmeldung = Vorgang.Fehlgeschlagen(antwort.fehler?.let(Meldung::Text) ?: Meldung.Resource(R.string.err_login_failed)))
            }
        }
    }

    /**
     * null, wenn es nicht weitergeht; der Zustand sagt dann schon, warum. Die
     * rpId muss der Host der eingerichteten Adresse sein (util/PasskeyHerkunft),
     * und die Adresse darf sich bis zur Antwort nicht ändern: Sonst ginge die
     * Signatur an einen anderen Server als den, dessen Optionen geprüft wurden.
     */
    private suspend fun fetchPasskey(zweck: String, abfrage: PasskeyQuery): JsonObject? {
        _loginState.update { it.copy(anmeldung = Vorgang.Laeuft) }
        val adresse = ablage.serverUrlJetzt()
        val optionen = when (val o = konto.passkeyOptions(zweck)) {
            is Ergebnis.Erfolg -> o.data.takeIf { it.isNotEmpty() } ?: return passkeyFailed(Meldung.Resource(R.string.login_passkey_fehler))
            is Ergebnis.Fehler -> return passkeyFailed(errorMessage(o))
        }
        if (ablage.serverUrlJetzt() != adresse) return passkeyFailed(Meldung.Resource(R.string.login_passkey_fehler))
        when (checkRpId(optionen, adresse)) {
            RpIdFinding.PASST -> Unit
            RpIdFinding.MISSING -> return passkeyFailed(Meldung.Resource(R.string.login_passkey_rpid_fehlt))
            RpIdFinding.FOREIGN -> return passkeyFailed(Meldung.Resource(R.string.login_passkey_rpid_fremd, listOf(hostOf(adresse))))
        }
        val ergebnis = abfrage.fetch(optionen.toString())
        if (ablage.serverUrlJetzt() != adresse) return passkeyFailed(Meldung.Resource(R.string.login_passkey_fehler))
        return when (val e = ergebnis) {
            is PasskeyResult.Antwort -> runCatching { Json.parseToJsonElement(e.json).jsonObject }.getOrNull()
                ?: passkeyFailed(Meldung.Resource(R.string.login_passkey_fehler))
            PasskeyResult.Abgebrochen -> passkeyFailed(null)
            PasskeyResult.NoPasskey -> passkeyFailed(Meldung.Resource(R.string.login_passkey_keiner))
            is PasskeyResult.Fehler -> passkeyFailed(Meldung.Resource(R.string.login_passkey_fehler))
        }
    }

    private fun passkeyFailed(satz: Meldung?): JsonObject? {
        _loginState.update { it.copy(anmeldung = beendet(satz)) }
        return null
    }

    private fun scope() = if (_loginState.value.vollerZugriff) TOKEN_SCOPE_FULL else TOKEN_SCOPE_APP

    /** Das Häkchen „mit Verwalterrechten“ im Anmeldeformular. */
    fun setFullAccess(an: Boolean) = _loginState.update { it.copy(vollerZugriff = an) }

    /**
     * Erst nach der Bestätigung im Einrichtungsbildschirm: Die Adresse kommt aus dem Code.
     * Sein Fingerabdruck gilt schon für die erste Anfrage, gemerkt wird er aber erst nach
     * gelungener Anmeldung.
     */
    fun loginWithQrToken(
        serverUrl: String, token: String, fingerabdruck: String? = null,
        pinSwitchInput: String? = null, geraet: String = "Android App",
    ) {
        val neu = NetworkPolicy.normalize(serverUrl)
        qrRejected(serverUrl, neu, fingerabdruck, pinSwitchInput)?.let { satz ->
            _loginState.update { it.copy(anmeldung = Vorgang.Fehlgeschlagen(Meldung.Resource(satz))) }
            return
        }
        val schluessel = if (fingerabdruck != null) pinKey(neu) else null
        viewModelScope.launch {
            _loginState.update { it.copy(anmeldung = Vorgang.Laeuft) }
            if (schluessel != null && fingerabdruck != null) ablage.holdBefore(schluessel, fingerabdruck)
            // Angemeldet bei einem anderen Server: Er bleibt, bis Browser und Konto-Ja die
            // Kopplung bestätigen (pairQr); ein Abbruch liesse sonst gar keine Anmeldung zurück.
            val switch = sitzung.state.value.isLoggedIn && !NetworkPolicy.sameServer(ablage.serverUrlJetzt(), neu)
            pairingWithSwitch = switch
            try {
                if (switch) ablage.kopplungsziel(neu) else ablage.saveServerUrl(neu)
                when (val r = afterCertificateQuestion(neu) { konto.qrLogin(token, geraet) }) {
                    is Ergebnis.Erfolg -> pairQr(r.data, QrTarget(neu, schluessel, fingerabdruck, switch))
                    // Eine Absage ohne Satz heisst hier: Der Code gilt nicht.
                    is Ergebnis.Fehler -> qrFailed(
                        if (r is Ergebnis.Fehler.Absage) Meldung.Resource(R.string.err_qr_login_failed) else errorMessage(r))
                }
            } finally {
                pairingWithSwitch = false
                if (switch) ablage.kopplungsziel(null)
                // Nach rememberPin ein No-op; sonst bleibt nichts vom Code zurück.
                if (schluessel != null) ablage.forgetRetained(schluessel)
            }
        }
    }

    /** Wohin ein QR-Code koppelt und ob dafür der bisherige Server verlassen wird. */
    private class QrTarget(val adresse: String, val schluessel: String?, val fingerabdruck: String?, val switch: Boolean)

    /** Solange eine Kopplung neben der bisherigen Anmeldung läuft, ist ihr Scheitern ein Fehler (qrFailed). */
    private var pairingWithSwitch = false

    /**
     * Ein Erstkontakt bricht den Handshake ab, bevor der Dialog beantwortet ist. Nach
     * dem Ja gilt der Pin, die Anfrage ging nie hinaus: ein zweiter Versuch, statt
     * „Keine Verbindung“ zu zeigen und den Nutzer neu scannen zu lassen.
     */
    private suspend fun <T> afterCertificateQuestion(adresse: String, abruf: suspend () -> Ergebnis<T>): Ergebnis<T> {
        val r = abruf()
        val schluessel = pinKey(adresse) ?: return r
        if (r !is Ergebnis.Fehler || frage.offen.value?.schluessel != schluessel) return r
        frage.offen.first { it == null }
        return if (ablage.rememberedPin(schluessel) != null) abruf() else r
    }

    /** Wartet die Kopplung auf das Ja oder Nein zum gezeigten Konto ([LoginUiState.qrAccount]). */
    private var qrDecision: CompletableDeferred<Boolean>? = null

    /** Das Ja oder Nein zum Konto, das der Server nach der Bestätigung im Browser nennt. */
    fun decideQrAccount(uebernehmen: Boolean) {
        qrDecision?.complete(uebernehmen)
    }

    /**
     * Der Pin wird erst gemerkt, wenn der Browser die Kopplung bestätigt und man das
     * gezeigte Konto angenommen hat: Ein abgelehnter, verfallener oder untergeschobener
     * Code darf keinen Schlüssel und keinen Token zurücklassen. Das Warten auf das Ja
     * bleibt in dieser Koroutine, damit der vorgehaltene Pin bis zur Abholung gilt.
     */
    private suspend fun pairQr(antwort: QrPairing, ziel: QrTarget) {
        val abholung = antwort.abholung
        _loginState.update { it.copy(qrBestaetigung = antwort.code) }
        val vorschau = waitOnConfirmation(abholung, antwort.validSeconds) ?: return
        val benutzer = vorschau.benutzer
        if (benutzer.isNullOrBlank()) {
            qrFailed(Meldung.Resource(R.string.err_qr_login_failed))
            return
        }
        if (!questionAfterAccount(QrAccount(benutzer, ziel.adresse))) {
            konto.discardQr(abholung)
            _loginState.update { it.copy(anmeldung = Vorgang.Fertig) }
            return
        }
        val newToken = vorschau.token ?: fetchQrToken(abholung) ?: return
        if (ziel.switch) leavePreviousServer(ziel.adresse)
        val schluessel = ziel.schluessel
        val fingerabdruck = ziel.fingerabdruck
        if (schluessel != null && fingerabdruck != null) ablage.rememberPin(schluessel, fingerabdruck)
        angemeldet(newToken, benutzer, false)
        _loginState.update { it.copy(anmeldung = Vorgang.Fertig) }
    }

    /**
     * Erst jetzt, mit dem Token des neuen Servers in der Hand: Die Kopplung endet, damit
     * das Abmelden den bisherigen Server erreicht und dessen Token dort entwertet.
     */
    private suspend fun leavePreviousServer(neu: String) {
        ablage.kopplungsziel(null)
        sessionService.abmelden().join()
        ablage.saveServerUrl(neu)
    }

    private suspend fun questionAfterAccount(gezeigt: QrAccount): Boolean {
        val decision = CompletableDeferred<Boolean>().also { qrDecision = it }
        _loginState.update { it.copy(qrBestaetigung = null, qrAccount = gezeigt) }
        return try {
            decision.await()
        } finally {
            qrDecision = null
            _loginState.update { it.copy(qrAccount = null) }
        }
    }

    private suspend fun fetchQrToken(abholung: String): String? {
        val satz = when (val r = konto.pickUpQr(abholung)) {
            is Ergebnis.Erfolg -> r.data.token?.let { return it } ?: r.data.fehler?.let(Meldung::Text) ?: Meldung.Resource(R.string.err_qr_login_failed)
            is Ergebnis.Fehler -> errorMessage(r)
        }
        qrFailed(satz)
        return null
    }

    /**
     * Warum der Code nicht angenommen wird, als Satz; null, wenn er gilt. Ein fremder
     * Schlüssel aus dem Code gilt nur abgetippt (mussAbtippen), sonst bliebe der Pin
     * des Angreifers gemerkt.
     */
    private fun qrRejected(serverUrl: String, neu: String, fingerabdruck: String?, eingabe: String?): Int? {
        when (NetworkPolicy.addressError(serverUrl, NetworkPolicy.entwicklung)) {
            null -> Unit
            NetworkPolicy.AddressError.PLAINTEXT -> return R.string.setup_qr_klartext_abgelehnt
            else -> return R.string.setup_invalid_qr
        }
        if (fingerabdruck == null || pinKey(neu) == null || !mussAbtippen(neu, fingerabdruck) ||
            Transcript.confirmed(eingabe, fingerabdruck)) return null
        return if (bisherigerPin(neu, fingerabdruck) != null) R.string.setup_qr_pin_wechsel_abgelehnt
            else R.string.setup_qr_pin_abtippen_abgelehnt
    }

    /**
     * Der gemerkte Pin für die Adresse, wenn er von [fingerabdruck] abweicht —
     * dann fragt der Einrichtungsbildschirm nach (bisher/neu), bevor er anmeldet.
     */
    fun bisherigerPin(serverUrl: String, fingerabdruck: String?): String? {
        if (fingerabdruck == null) return null
        val schluessel = pinKey(NetworkPolicy.normalize(serverUrl)) ?: return null
        return ablage.rememberedPin(schluessel)?.takeIf { it != fingerabdruck }
    }

    /**
     * Muss der Fingerabdruck des Codes aus der Webapp abgetippt werden? Ohne Abtippen
     * gilt nur der schon bestätigte Pin oder eine System-Wurzel: Deren Kette muss
     * ohnehin öffentlich gültig sein, ein fremder Schlüssel aus dem Code nicht.
     */
    fun mussAbtippen(serverUrl: String, fingerabdruck: String?): Boolean {
        if (fingerabdruck == null) return false
        val schluessel = pinKey(NetworkPolicy.normalize(serverUrl)) ?: return false
        val gemerkt = ablage.rememberedPin(schluessel)
        return if (gemerkt != null) gemerkt != fingerabdruck else !systemRoots.contains(fingerabdruck)
    }

    /**
     * Fragt, bis der Browser die Kopplung bestätigt oder ablehnt; null heisst gescheitert,
     * der Zustand sagt dann schon, warum. Nach der Frist des Codes fragt die App nicht weiter.
     */
    private suspend fun waitOnConfirmation(abholung: String, seconds: Int): QrAbholstand? {
        val ende = System.currentTimeMillis() + seconds * 1000L
        while (System.currentTimeMillis() < ende) {
            when (val r = konto.pickUpQr(abholung, vorschau = true)) {
                is Ergebnis.Erfolg -> if (r.data.vorschau || r.data.token != null) return r.data
                    else if (!r.data.wartet) return qrFailed(r.data.fehler?.let(Meldung::Text) ?: Meldung.Resource(R.string.err_qr_login_failed))
                is Ergebnis.Fehler -> return qrFailed(errorMessage(r))
            }
            delay(QR_QUERY_MS)
        }
        return qrFailed(Meldung.Resource(R.string.err_qr_login_failed))
    }

    /** Ein zweiter QR-Anlauf nach einer gelungenen Anmeldung ist kein Fehler (siehe qrError). */
    private fun qrFailed(satz: Meldung): QrAbholstand? {
        val alreadySignedIn = sitzung.state.value.isLoggedIn && !pairingWithSwitch
        _loginState.update { it.copy(qrBestaetigung = null, qrAccount = null,
            anmeldung = beendet(qrError(alreadySignedIn, satz))) }
        return null
    }

    /**
     * Jede Anmeldung beginnt mit „alle Konten“ — VOR dem Token: Er stösst das
     * Laden von Konten und Filtern an, und das soll den geleerten Stand sehen.
     */
    private suspend fun angemeldet(token: String, benutzer: String, admin: Boolean) {
        scopeService.loginBegins()
        ablage.saveAuthToken(token)
        ablage.saveUsername(benutzer)
        sitzung.angemeldet(admin)
    }

    /** Ohne Antwort bleibt der Link verborgen: Ein Knopf ins Leere ist schlechter als keiner. */
    fun openCheckRegistration() {
        viewModelScope.launch {
            when (val r = konto.getRegistrationStatus()) {
                is Ergebnis.Erfolg -> _loginState.update { it.copy(registrierungOffen = r.data.offen) }
                is Ergebnis.Fehler -> Unit
            }
        }
    }

    fun showLoginForm(formular: AnmeldeFormular) {
        // Meldung und Fehler gehen mit, sonst stünde die Bestätigung der
        // Registrierung noch im Formular „Passwort vergessen“.
        _loginState.update { it.copy(formular = formular, meldung = null, hinweis = null, konto = it.konto.withoutError()) }
    }

    fun registriere(username: String, email: String, vorname: String, nachname: String, passwort: String) {
        viewModelScope.launch {
            _loginState.update { it.copy(konto = Vorgang.Laeuft, meldung = null, hinweis = null) }
            val anfrage = Kontoanlage(
                benutzer = username.trim(),
                email = email.trim(),
                vorname = vorname.trim().ifBlank { null },
                nachname = nachname.trim().ifBlank { null },
                passwort = passwort,
                // Die Sprache der Oberfläche steuert Bestätigungs-E-Mail und Kontoeinstellung.
                sprache = meldungen.text(R.string.lang_code),
            )
            when (val r = konto.register(anfrage)) {
                is Ergebnis.Erfolg -> {
                    // Ohne Mailversand wartet man sonst auf eine E-Mail, die nie kommt.
                    _loginState.update { it.copy(konto = Vorgang.Fertig,
                        meldung = r.data.meldung?.let(Meldung::Text) ?: Meldung.Resource(R.string.register_done),
                        hinweis = if (r.data.withoutMailversand) Meldung.Resource(R.string.register_console_hint) else null) }
                }
                is Ergebnis.Fehler -> _loginState.update { it.copy(konto = gescheitert(r)) }
            }
        }
    }

    /**
     * Die Antwort des Servers ist absichtlich immer dieselbe; sie wird
     * unverändert gezeigt, sonst verriete die App, was der Server verschweigt.
     */
    fun passwortVergessen(email: String) {
        viewModelScope.launch {
            _loginState.update { it.copy(konto = Vorgang.Laeuft, meldung = null, hinweis = null) }
            when (val r = konto.forgotPassword(email.trim())) {
                is Ergebnis.Erfolg -> _loginState.update {
                    it.copy(konto = Vorgang.Fertig, meldung = r.data?.let(Meldung::Text) ?: Meldung.Resource(R.string.forgot_done))
                }
                is Ergebnis.Fehler -> _loginState.update { it.copy(konto = gescheitert(r)) }
            }
        }
    }

    private fun reset() {
        _loginState.value = LoginUiState()
    }
}
