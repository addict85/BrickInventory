package ch.brickinventoryapp.login.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.dataapi.account.AccountRepository
import ch.brickinventoryapp.dataapi.session.LoginStore
import ch.brickinventoryapp.login.ui.LoginForm
import ch.brickinventoryapp.login.ui.LoginUiState
import ch.brickinventoryapp.login.ui.PasskeyQuery
import ch.brickinventoryapp.login.ui.PasskeyResult
import ch.brickinventoryapp.login.ui.QrAccount
import ch.brickinventoryapp.model.address.AddressError
import ch.brickinventoryapp.model.address.AddressRules
import ch.brickinventoryapp.model.domain.AccountCreation
import ch.brickinventoryapp.model.domain.Login
import ch.brickinventoryapp.model.domain.PASSKEY_SECOND_FACTOR
import ch.brickinventoryapp.model.domain.PASSKEY_SIGN_IN
import ch.brickinventoryapp.model.domain.QrPairing
import ch.brickinventoryapp.model.domain.QrPickupState
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_APP
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_FULL
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.RpIdFinding
import ch.brickinventoryapp.security.SystemRoots
import ch.brickinventoryapp.security.Transcript
import ch.brickinventoryapp.security.checkRpId
import ch.brickinventoryapp.security.hostOf
import ch.brickinventoryapp.security.pinKey
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.SessionRepository
import ch.brickinventoryapp.session.qrError
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.state.ui.failed
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import ch.brickinventoryapp.uistate.Operation
import ch.brickinventoryapp.uistate.ended
import ch.brickinventoryapp.uistate.withoutError
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import javax.inject.Inject

/** How often the app asks, after the QR scan, whether the browser has confirmed the pairing. */
internal const val QR_QUERY_MS = 2_000L

/**
 * Set up a server, sign in (password, second factor, passkey, QR), create an account,
 * forgot password. Bound to the Activity, because the QR path
 * leaves setup while sign-in is still running.
 */
@HiltViewModel
internal class LoginViewModel @Inject constructor(
    private val session: Session,
    private val scopeService: Scope,
    private val messages: Messages,
    private val sessionService: SessionRepository,
    private val account: AccountRepository,
    private val store: LoginStore,
    private val question: CertificateQuestion,
    private val systemRoots: SystemRoots,
    private val saved: SavedStateHandle,
    private val addresses: AddressRules,
) : ViewModel() {

    val state: StateFlow<AppUiState> = session.state

    init {
        logoutSequence(session) { reset() }
    }

    private val _loginState = MutableStateFlow(LoginUiState(
        form = LoginForm.entries.firstOrNull { it.name == saved[FORM] } ?: LoginForm.LOGIN,
        fullAccess = saved[FULL_ACCESS] ?: false))
    internal val loginState: StateFlow<LoginUiState> = _loginState.asStateFlow()

    init {
        // The open form and the admin checkbox survive a process death; the typed text lives
        // in the screen (rememberSaveable), password and code deliberately nowhere.
        viewModelScope.launch {
            _loginState.collect {
                saved[FORM] = it.form.name
                saved[FULL_ACCESS] = it.fullAccess
            }
        }
    }

    /**
     * Only an https address is saved; false means rejected, setup
     * stays put. A different server signs out completely beforehand
     * (via the SessionService, the app's usual path), because the token belongs to the old one.
     */
    fun saveServerUrl(url: String): Boolean {
        val newValue = addresses.normalize(url)
        if (addresses.addressError(newValue, addresses.development) != null) return false
        viewModelScope.launch { setUpOne(newValue) }
        return true
    }

    private suspend fun setUpOne(newValue: String) {
        if (session.state.value.isLoggedIn && !addresses.sameServer(store.serverUrlNow(), newValue)) {
            sessionService.logout().join()
        }
        store.saveServerUrl(newValue)
    }

    fun login(username: String, password: String, code: String? = null) {
        viewModelScope.launch { withPassword(username, password, code) }
    }

    /** The passkey replaces the second-factor code; name and password go along. */
    internal fun passkeyInsteadOfCode(username: String, password: String, query: PasskeyQuery) {
        viewModelScope.launch {
            withPassword(username, password, null) { fetchPasskey(PASSKEY_SECOND_FACTOR, query) }
        }
    }

    /** Without a password: the Credential Manager offers this server's passkeys. */
    internal fun loginPasskey(query: PasskeyQuery) {
        viewModelScope.launch {
            _loginState.update { it.copy(login = Operation.Running) }
            val response = fetchPasskey(PASSKEY_SIGN_IN, query) ?: return@launch
            when (val r = account.loginPasskey(store.serverUrlNow(), response, scope())) {
                is Outcome.Success -> afterResponse(r.data, "", withCode = false)
                is Outcome.Failure -> _loginState.update { it.copy(login = failed(r)) }
            }
        }
    }

    /** [passkey] runs before sending: a cancelled dialog should not leave behind a half sign-in. */
    private suspend fun withPassword(username: String, password: String, code: String?,
                                    passkey: (suspend () -> JsonObject?)? = null) {
        val url = store.serverUrlNow()
        _loginState.update { it.copy(login = Operation.Running) }
        val response = passkey?.let { it() ?: return }
        val withCode = !code.isNullOrBlank() || response != null
        when (val r = account.login(url, username, password, code?.trim()?.takeIf { it.isNotEmpty() }, scope(), response)) {
            is Outcome.Success -> {
                if (r.data.response.secondFactor)
                    _loginState.update { it.copy(passkeyInsteadOfCode = r.data.passkeyInsteadOfCode) }
                afterResponse(r.data.response, username, withCode)
            }
            is Outcome.Failure -> _loginState.update { it.copy(login = failed(r)) }
        }
    }

    /** [withCode]: a second factor was sent along; then a no from the server is an error. */
    private suspend fun afterResponse(response: Login, user: String, withCode: Boolean) {
        // Into a local variable: the model lives in core-model, and across the
        // module boundary Kotlin does not check `!= null` for the call below it.
        val newToken = response.token
        when {
            response.secondFactor -> _loginState.update { it.copy(codeNeeded = true,
                login = ended(if (withCode) response.error?.let(Message::Text) else null)) }
            response.success && newToken != null -> {
                loggedIn(newToken, response.user ?: user, response.admin)
                _loginState.update { it.copy(codeNeeded = false, passkeyInsteadOfCode = false, login = Operation.Done) }
            }
            else -> _loginState.update {
                it.copy(login = Operation.Failed(response.error?.let(Message::Text) ?: Message.Resource(R.string.err_login_failed)))
            }
        }
    }

    /**
     * null if it does not continue; the state already says why in that case. The
     * rpId must be the host of the configured address (util/PasskeyHerkunft),
     * and the address must not change until the answer: otherwise the
     * signature would go to a different server than the one whose options were checked.
     */
    private suspend fun fetchPasskey(purpose: String, query: PasskeyQuery): JsonObject? {
        _loginState.update { it.copy(login = Operation.Running) }
        val address = store.serverUrlNow()
        val options = when (val o = account.passkeyOptions(purpose)) {
            is Outcome.Success -> o.data.takeIf { it.isNotEmpty() } ?: return passkeyFailed(Message.Resource(R.string.login_passkey_error))
            is Outcome.Failure -> return passkeyFailed(errorMessage(o))
        }
        if (store.serverUrlNow() != address) return passkeyFailed(Message.Resource(R.string.login_passkey_error))
        when (checkRpId(options, address)) {
            RpIdFinding.MATCHES -> Unit
            RpIdFinding.MISSING -> return passkeyFailed(Message.Resource(R.string.login_passkey_rpid_missing))
            RpIdFinding.FOREIGN -> return passkeyFailed(Message.Resource(R.string.login_passkey_rpid_foreign, listOf(hostOf(address))))
        }
        val outcome = query.fetch(options.toString())
        if (store.serverUrlNow() != address) return passkeyFailed(Message.Resource(R.string.login_passkey_error))
        return when (val e = outcome) {
            is PasskeyResult.Response -> runCatching { Json.parseToJsonElement(e.json).jsonObject }.getOrNull()
                ?: passkeyFailed(Message.Resource(R.string.login_passkey_error))
            PasskeyResult.Cancelled -> passkeyFailed(null)
            PasskeyResult.NoPasskey -> passkeyFailed(Message.Resource(R.string.login_passkey_none))
            is PasskeyResult.Failure -> passkeyFailed(Message.Resource(R.string.login_passkey_error))
        }
    }

    private fun passkeyFailed(sentence: Message?): JsonObject? {
        _loginState.update { it.copy(login = ended(sentence)) }
        return null
    }

    private fun scope() = if (_loginState.value.fullAccess) TOKEN_SCOPE_FULL else TOKEN_SCOPE_APP

    /** The „mit Verwalterrechten“ checkbox in the sign-in form. */
    fun setFullAccess(an: Boolean) = _loginState.update { it.copy(fullAccess = an) }

    /**
     * Only after the confirmation in the setup screen: the address comes from the code.
     * Its fingerprint already applies to the first request, but it is only remembered after
     * a successful sign-in.
     */
    fun loginWithQrToken(
        serverUrl: String, token: String, fingerprint: String? = null,
        pinSwitchInput: String? = null, device: String = "Android App",
    ) {
        val newValue = addresses.normalize(serverUrl)
        qrRejected(serverUrl, newValue, fingerprint, pinSwitchInput)?.let { sentence ->
            _loginState.update { it.copy(login = Operation.Failed(Message.Resource(sentence))) }
            return
        }
        val key = if (fingerprint != null) pinKey(newValue) else null
        viewModelScope.launch {
            _loginState.update { it.copy(login = Operation.Running) }
            if (key != null && fingerprint != null) store.holdBefore(key, fingerprint)
            // Signed in to a different server: it stays until the browser and account-yes confirm the
            // pairing (pairQr); a cancel would otherwise leave no sign-in at all.
            val switch = session.state.value.isLoggedIn && !addresses.sameServer(store.serverUrlNow(), newValue)
            pairingWithSwitch = switch
            try {
                if (switch) store.pairingTarget(newValue) else store.saveServerUrl(newValue)
                when (val r = afterCertificateQuestion(newValue) { account.qrLogin(token, device) }) {
                    is Outcome.Success -> pairQr(r.data, QrTarget(newValue, key, fingerprint, switch))
                    // A rejection without a sentence means here: the code is not valid.
                    is Outcome.Failure -> qrFailed(
                        if (r is Outcome.Failure.Refusal) Message.Resource(R.string.err_qr_login_failed) else errorMessage(r))
                }
            } finally {
                pairingWithSwitch = false
                if (switch) store.pairingTarget(null)
                // A no-op after rememberPin; otherwise nothing of the code remains.
                if (key != null) store.forgetRetained(key)
            }
        }
    }

    /** Where a QR code pairs to and whether that leaves the previous server. */
    private class QrTarget(val address: String, val key: String?, val fingerprint: String?, val switch: Boolean)

    /** As long as a pairing runs alongside the existing sign-in, its failure is an error (qrFailed). */
    private var pairingWithSwitch = false

    /**
     * A first contact aborts the handshake before the dialog is answered. After
     * the yes the pin applies, the request never went out: a second attempt, instead of
     * showing "no connection" and making the user scan again.
     */
    private suspend fun <T> afterCertificateQuestion(address: String, fetch: suspend () -> Outcome<T>): Outcome<T> {
        val r = fetch()
        val key = pinKey(address) ?: return r
        if (r !is Outcome.Failure || question.open.value?.key != key) return r
        question.open.first { it == null }
        return if (store.rememberedPin(key) != null) fetch() else r
    }

    /** The pairing waits for the yes or no to the shown account ([LoginUiState.qrAccount]). */
    private var qrDecision: CompletableDeferred<Boolean>? = null

    /** The yes or no to the account that the server names after the confirmation in the browser. */
    fun decideQrAccount(adopt: Boolean) {
        qrDecision?.complete(adopt)
    }

    /**
     * The pin is only remembered once the browser confirms the pairing and the
     * shown account has been accepted: a rejected, expired or planted
     * code must leave behind no key and no token. Waiting for the yes stays
     * in this coroutine, so that the held pin is valid until it is collected.
     */
    private suspend fun pairQr(response: QrPairing, target: QrTarget) {
        val pickup = response.pickup
        _loginState.update { it.copy(qrConfirmation = response.code) }
        val preview = waitOnConfirmation(pickup, response.validSeconds) ?: return
        val user = preview.user
        if (user.isNullOrBlank()) {
            qrFailed(Message.Resource(R.string.err_qr_login_failed))
            return
        }
        if (!questionAfterAccount(QrAccount(user, target.address))) {
            account.discardQr(pickup)
            _loginState.update { it.copy(login = Operation.Done) }
            return
        }
        val newToken = preview.token ?: fetchQrToken(pickup) ?: return
        if (target.switch) leavePreviousServer(target.address)
        val key = target.key
        val fingerprint = target.fingerprint
        if (key != null && fingerprint != null) store.rememberPin(key, fingerprint)
        loggedIn(newToken, user, false)
        _loginState.update { it.copy(login = Operation.Done) }
    }

    /**
     * Only now, with the new server's token in hand: the pairing ends, so that
     * signing out reaches the previous server and invalidates its token there.
     */
    private suspend fun leavePreviousServer(newValue: String) {
        store.pairingTarget(null)
        sessionService.logout().join()
        store.saveServerUrl(newValue)
    }

    private suspend fun questionAfterAccount(shown: QrAccount): Boolean {
        val decision = CompletableDeferred<Boolean>().also { qrDecision = it }
        _loginState.update { it.copy(qrConfirmation = null, qrAccount = shown) }
        return try {
            decision.await()
        } finally {
            qrDecision = null
            _loginState.update { it.copy(qrAccount = null) }
        }
    }

    private suspend fun fetchQrToken(pickup: String): String? {
        val sentence = when (val r = account.pickUpQr(pickup)) {
            is Outcome.Success -> r.data.token?.let { return it } ?: r.data.error?.let(Message::Text) ?: Message.Resource(R.string.err_qr_login_failed)
            is Outcome.Failure -> errorMessage(r)
        }
        qrFailed(sentence)
        return null
    }

    /**
     * Why the code is not accepted, as a sentence; null if it is valid. A foreign
     * key from the code only counts when typed off (mustTypeIn), otherwise the
     * attacker's pin would stay remembered.
     */
    private fun qrRejected(serverUrl: String, newValue: String, fingerprint: String?, input: String?): Int? {
        when (addresses.addressError(serverUrl, addresses.development)) {
            null -> Unit
            AddressError.PLAINTEXT -> return R.string.setup_qr_plaintext_declined
            else -> return R.string.setup_invalid_qr
        }
        if (fingerprint == null || pinKey(newValue) == null || !mustTypeIn(newValue, fingerprint) ||
            Transcript.confirmed(input, fingerprint)) return null
        return if (previousPin(newValue, fingerprint) != null) R.string.setup_qr_pin_switch_declined
            else R.string.setup_qr_pin_type_declined
    }

    /**
     * The remembered pin for the address, if it deviates from [fingerprint] —
     * then the setup screen asks (old/new) before signing in.
     */
    fun previousPin(serverUrl: String, fingerprint: String?): String? {
        if (fingerprint == null) return null
        val key = pinKey(addresses.normalize(serverUrl)) ?: return null
        return store.rememberedPin(key)?.takeIf { it != fingerprint }
    }

    /**
     * Must the code's fingerprint from the web app be typed off? Without typing it off,
     * only the already confirmed pin or a system root applies: its chain must
     * be publicly valid anyway, a foreign key from the code need not be.
     */
    fun mustTypeIn(serverUrl: String, fingerprint: String?): Boolean {
        if (fingerprint == null) return false
        val key = pinKey(addresses.normalize(serverUrl)) ?: return false
        val wanted = store.rememberedPin(key)
        return if (wanted != null) wanted != fingerprint else !systemRoots.contains(fingerprint)
    }

    /**
     * Asks until the browser confirms or rejects the pairing; null means failed,
     * the state then already says why. After the code's deadline the app does not ask further.
     */
    private suspend fun waitOnConfirmation(pickup: String, seconds: Int): QrPickupState? {
        val end = System.currentTimeMillis() + seconds * 1000L
        while (System.currentTimeMillis() < end) {
            when (val r = account.pickUpQr(pickup, preview = true)) {
                is Outcome.Success -> if (r.data.preview || r.data.token != null) return r.data
                    else if (!r.data.waiting) return qrFailed(r.data.error?.let(Message::Text) ?: Message.Resource(R.string.err_qr_login_failed))
                is Outcome.Failure -> return qrFailed(errorMessage(r))
            }
            delay(QR_QUERY_MS)
        }
        return qrFailed(Message.Resource(R.string.err_qr_login_failed))
    }

    /** A second QR attempt after a successful sign-in is not an error (see qrError). */
    private fun qrFailed(sentence: Message): QrPickupState? {
        val alreadyLoggedIn = session.state.value.isLoggedIn && !pairingWithSwitch
        _loginState.update { it.copy(qrConfirmation = null, qrAccount = null,
            login = ended(qrError(alreadyLoggedIn, sentence))) }
        return null
    }

    /**
     * Every sign-in starts with "all accounts" — BEFORE the token: it triggers the
     * loading of accounts and filters, and that should see the cleared state.
     */
    private suspend fun loggedIn(token: String, user: String, admin: Boolean) {
        scopeService.loginBegins()
        store.saveAuthToken(token)
        store.saveUsername(user)
        session.loggedIn(admin)
    }

    /** Without an answer, the link stays hidden: a button leading nowhere is worse than none. */
    fun openCheckRegistration() {
        viewModelScope.launch {
            when (val r = account.getRegistrationStatus()) {
                is Outcome.Success -> _loginState.update { it.copy(registrationOpen = r.data.open) }
                is Outcome.Failure -> Unit
            }
        }
    }

    fun showLoginForm(form: LoginForm) {
        // The message and error go along, otherwise the registration's confirmation
        // would still be showing in the "forgot password" form.
        _loginState.update { it.copy(form = form, message = null, hint = null, account = it.account.withoutError()) }
    }

    fun register(username: String, email: String, firstName: String, lastName: String, password: String) {
        viewModelScope.launch {
            _loginState.update { it.copy(account = Operation.Running, message = null, hint = null) }
            val request = AccountCreation(
                user = username.trim(),
                email = email.trim(),
                firstName = firstName.trim().ifBlank { null },
                lastName = lastName.trim().ifBlank { null },
                password = password,
                // The UI's language controls the confirmation email and the account setting.
                language = messages.text(R.string.lang_code),
            )
            when (val r = account.register(request)) {
                is Outcome.Success -> {
                    // Without mail sending, one would otherwise wait for an email that never comes.
                    _loginState.update { it.copy(account = Operation.Done,
                        message = r.data.message?.let(Message::Text) ?: Message.Resource(R.string.register_done),
                        hint = if (r.data.withoutMailSending) Message.Resource(R.string.register_console_hint) else null) }
                }
                is Outcome.Failure -> _loginState.update { it.copy(account = failed(r)) }
            }
        }
    }

    /**
     * The server's answer is deliberately always the same; it is
     * shown unchanged, otherwise the app would give away what the server keeps secret.
     */
    fun passwordForget(email: String) {
        viewModelScope.launch {
            _loginState.update { it.copy(account = Operation.Running, message = null, hint = null) }
            when (val r = account.forgotPassword(email.trim())) {
                is Outcome.Success -> _loginState.update {
                    it.copy(account = Operation.Done, message = r.data?.let(Message::Text) ?: Message.Resource(R.string.forgot_done))
                }
                is Outcome.Failure -> _loginState.update { it.copy(account = failed(r)) }
            }
        }
    }

    private fun reset() {
        _loginState.value = LoginUiState()
    }
}

private const val FORM = "login.form"
private const val FULL_ACCESS = "login.fullAccess"
