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

/** How often the app asks, after the QR scan, whether the browser has confirmed the pairing. */
internal const val QR_QUERY_MS = 2_000L

/**
 * Set up a server, sign in (password, second factor, passkey, QR), create an account,
 * forgot password. Bound to the Activity, because the QR path
 * leaves setup while sign-in is still running.
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
     * Only an https address is saved; false means rejected, setup
     * stays put. A different server signs out completely beforehand
     * (via the SitzungsDienst, the app's usual path), because the token belongs to the old one.
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

    /** The passkey replaces the second-factor code; name and password go along. */
    internal fun passkeyStattCode(username: String, password: String, abfrage: PasskeyQuery) {
        viewModelScope.launch {
            withPassword(username, password, null) { fetchPasskey(PASSKEY_SECOND_FACTOR, abfrage) }
        }
    }

    /** Without a password: the Credential Manager offers this server's passkeys. */
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

    /** [passkey] runs before sending: a cancelled dialog should not leave behind a half sign-in. */
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

    /** [withCode]: a second factor was sent along; then a no from the server is an error. */
    private suspend fun afterResponse(antwort: Anmeldung, benutzer: String, withCode: Boolean) {
        // Into a local variable: the model lives in core-model, and across the
        // module boundary Kotlin does not check `!= null` for the call below it.
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
     * null if it does not continue; the state already says why in that case. The
     * rpId must be the host of the configured address (util/PasskeyHerkunft),
     * and the address must not change until the answer: otherwise the
     * signature would go to a different server than the one whose options were checked.
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

    /** The „mit Verwalterrechten“ checkbox in the sign-in form. */
    fun setFullAccess(an: Boolean) = _loginState.update { it.copy(vollerZugriff = an) }

    /**
     * Only after the confirmation in the setup screen: the address comes from the code.
     * Its fingerprint already applies to the first request, but it is only remembered after
     * a successful sign-in.
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
            // Signed in to a different server: it stays until the browser and account-yes confirm the
            // pairing (pairQr); a cancel would otherwise leave no sign-in at all.
            val switch = sitzung.state.value.isLoggedIn && !NetworkPolicy.sameServer(ablage.serverUrlJetzt(), neu)
            pairingWithSwitch = switch
            try {
                if (switch) ablage.kopplungsziel(neu) else ablage.saveServerUrl(neu)
                when (val r = afterCertificateQuestion(neu) { konto.qrLogin(token, geraet) }) {
                    is Ergebnis.Erfolg -> pairQr(r.data, QrTarget(neu, schluessel, fingerabdruck, switch))
                    // A rejection without a sentence means here: the code is not valid.
                    is Ergebnis.Fehler -> qrFailed(
                        if (r is Ergebnis.Fehler.Absage) Meldung.Resource(R.string.err_qr_login_failed) else errorMessage(r))
                }
            } finally {
                pairingWithSwitch = false
                if (switch) ablage.kopplungsziel(null)
                // A no-op after rememberPin; otherwise nothing of the code remains.
                if (schluessel != null) ablage.forgetRetained(schluessel)
            }
        }
    }

    /** Where a QR code pairs to and whether that leaves the previous server. */
    private class QrTarget(val adresse: String, val schluessel: String?, val fingerabdruck: String?, val switch: Boolean)

    /** As long as a pairing runs alongside the existing sign-in, its failure is an error (qrFailed). */
    private var pairingWithSwitch = false

    /**
     * A first contact aborts the handshake before the dialog is answered. After
     * the yes the pin applies, the request never went out: a second attempt, instead of
     * showing "no connection" and making the user scan again.
     */
    private suspend fun <T> afterCertificateQuestion(adresse: String, abruf: suspend () -> Ergebnis<T>): Ergebnis<T> {
        val r = abruf()
        val schluessel = pinKey(adresse) ?: return r
        if (r !is Ergebnis.Fehler || frage.offen.value?.schluessel != schluessel) return r
        frage.offen.first { it == null }
        return if (ablage.rememberedPin(schluessel) != null) abruf() else r
    }

    /** The pairing waits for the yes or no to the shown account ([LoginUiState.qrAccount]). */
    private var qrDecision: CompletableDeferred<Boolean>? = null

    /** The yes or no to the account that the server names after the confirmation in the browser. */
    fun decideQrAccount(uebernehmen: Boolean) {
        qrDecision?.complete(uebernehmen)
    }

    /**
     * The pin is only remembered once the browser confirms the pairing and the
     * shown account has been accepted: a rejected, expired or planted
     * code must leave behind no key and no token. Waiting for the yes stays
     * in this coroutine, so that the held pin is valid until it is collected.
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
     * Only now, with the new server's token in hand: the pairing ends, so that
     * signing out reaches the previous server and invalidates its token there.
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
     * Why the code is not accepted, as a sentence; null if it is valid. A foreign
     * key from the code only counts when typed off (mussAbtippen), otherwise the
     * attacker's pin would stay remembered.
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
     * The remembered pin for the address, if it deviates from [fingerabdruck] —
     * then the setup screen asks (old/new) before signing in.
     */
    fun bisherigerPin(serverUrl: String, fingerabdruck: String?): String? {
        if (fingerabdruck == null) return null
        val schluessel = pinKey(NetworkPolicy.normalize(serverUrl)) ?: return null
        return ablage.rememberedPin(schluessel)?.takeIf { it != fingerabdruck }
    }

    /**
     * Must the code's fingerprint from the web app be typed off? Without typing it off,
     * only the already confirmed pin or a system root applies: its chain must
     * be publicly valid anyway, a foreign key from the code need not be.
     */
    fun mussAbtippen(serverUrl: String, fingerabdruck: String?): Boolean {
        if (fingerabdruck == null) return false
        val schluessel = pinKey(NetworkPolicy.normalize(serverUrl)) ?: return false
        val gemerkt = ablage.rememberedPin(schluessel)
        return if (gemerkt != null) gemerkt != fingerabdruck else !systemRoots.contains(fingerabdruck)
    }

    /**
     * Asks until the browser confirms or rejects the pairing; null means failed,
     * the state then already says why. After the code's deadline the app does not ask further.
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

    /** A second QR attempt after a successful sign-in is not an error (see qrError). */
    private fun qrFailed(satz: Meldung): QrAbholstand? {
        val alreadySignedIn = sitzung.state.value.isLoggedIn && !pairingWithSwitch
        _loginState.update { it.copy(qrBestaetigung = null, qrAccount = null,
            anmeldung = beendet(qrError(alreadySignedIn, satz))) }
        return null
    }

    /**
     * Every sign-in starts with "all accounts" — BEFORE the token: it triggers the
     * loading of accounts and filters, and that should see the cleared state.
     */
    private suspend fun angemeldet(token: String, benutzer: String, admin: Boolean) {
        scopeService.loginBegins()
        ablage.saveAuthToken(token)
        ablage.saveUsername(benutzer)
        sitzung.angemeldet(admin)
    }

    /** Without an answer, the link stays hidden: a button leading nowhere is worse than none. */
    fun openCheckRegistration() {
        viewModelScope.launch {
            when (val r = konto.getRegistrationStatus()) {
                is Ergebnis.Erfolg -> _loginState.update { it.copy(registrierungOffen = r.data.offen) }
                is Ergebnis.Fehler -> Unit
            }
        }
    }

    fun showLoginForm(formular: AnmeldeFormular) {
        // The message and error go along, otherwise the registration's confirmation
        // would still be showing in the "forgot password" form.
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
                // The UI's language controls the confirmation email and the account setting.
                sprache = meldungen.text(R.string.lang_code),
            )
            when (val r = konto.register(anfrage)) {
                is Ergebnis.Erfolg -> {
                    // Without mail sending, one would otherwise wait for an email that never comes.
                    _loginState.update { it.copy(konto = Vorgang.Fertig,
                        meldung = r.data.meldung?.let(Meldung::Text) ?: Meldung.Resource(R.string.register_done),
                        hinweis = if (r.data.withoutMailversand) Meldung.Resource(R.string.register_console_hint) else null) }
                }
                is Ergebnis.Fehler -> _loginState.update { it.copy(konto = gescheitert(r)) }
            }
        }
    }

    /**
     * The server's answer is deliberately always the same; it is
     * shown unchanged, otherwise the app would give away what the server keeps secret.
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
