package ch.brickinventoryapp.account.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.account.ui.DesignChoice
import ch.brickinventoryapp.account.ui.DevicesPrompt
import ch.brickinventoryapp.account.ui.DevicesUiState
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.account.AccountRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.model.domain.DesignState
import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.model.domain.ProfileChange
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.model.ui.ended
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.ui.withoutError
import ch.brickinventoryapp.model.util.otpauthAddress
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.SessionRepository
import ch.brickinventoryapp.state.ui.failed
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * One's own account: profile, password, signed-in devices, second factor.
 *
 * Tied to the account page's destination, not to the Activity: profile,
 * device list and a half-set-up TOTP secret only live as long as
 * the page is open, and no sign-out needs to clean them up separately.
 */
@HiltViewModel
class AccountViewModel @Inject constructor(
    private val account: AccountRepository,
    private val messages: MessageChannel,
    private val session: Session,
    private val sessionService: SessionRepository,
) : ViewModel() {

    private val _accountState = MutableStateFlow(AccountUiState())
    val accountState = _accountState.asStateFlow()
    private val _devicesState = MutableStateFlow(DevicesUiState())
    internal val devicesState = _devicesState.asStateFlow()
    private val _secondFactorState = MutableStateFlow(SecondFactorUiState())
    val secondFactorState = _secondFactorState.asStateFlow()

    /**
     * The account state, as the account page reads it: only whoever opens it loads profile and
     * design. The start-password mask reads [accountState] and loads nothing.
     */
    private val pageObserved = Observed(accountState)
    val accountPage: StateFlow<AccountUiState> = pageObserved

    init {
        observeLoadOn(pageObserved) { loadProfile(); loadDesign() }
        observeLoadOn(_devicesState) { loadDevices() }
        observeLoadOn(_secondFactorState) { loadSecondFactor() }
    }

    // ── Profile and password ──────────────────────────────────────────────────

    fun loadProfile() {
        viewModelScope.launch {
            _accountState.update { it.copy(fetch = Load.Loads, save = it.save.withoutError()) }
            fetchProfile()
        }
    }

    /** Leaves an error standing that the save set beforehand (mail not sent). */
    private suspend fun fetchProfile() {
        when (val r = account.getProfile()) {
            is Outcome.Success -> _accountState.update {
                it.copy(fetch = Load.Data(Unit), profile = r.data)
            }
            is Outcome.Failure -> _accountState.update { it.copy(fetch = loadError(r)) }
        }
    }

    fun saveProfile(
        username: String, email: String, firstName: String, lastName: String, password: String? = null,
        code: String? = null,
    ) {
        // The server requires the password for every profile change; don't even ask without it.
        if (password.isNullOrBlank()) {
            _accountState.update { it.copy(save = Operation.Failed(Message.Resource(R.string.account_profile_password_needed)), message = null) }
            return
        }
        viewModelScope.launch {
            _accountState.update { it.copy(save = Operation.Running, message = null) }
            val change = ProfileChange(
                user = username.trim(),
                email = email.trim(),
                // Empty means "not given", not "empty first name".
                firstName = firstName.trim().ifBlank { null },
                lastName = lastName.trim().ifBlank { null },
                passwordCurrent = password,
                code = code?.trim()?.ifBlank { null },
            )
            when (val r = account.updateProfile(change)) {
                is Outcome.Success -> {
                        // A new address only takes effect after the link: "saved" alone would
                        // suggest it already applies, and without the mail it waits for nothing.
                        val newAddress = r.data.newAddress
                        val withoutMail = newAddress && !r.data.mailSent
                        _accountState.update { it.copy(codeNeeded = false,
                            message = when {
                                withoutMail -> null
                                newAddress -> Message.Resource(R.string.account_email_link_sent, listOf(change.email))
                                else -> Message.Resource(R.string.account_saved)
                            },
                            save = ended(if (withoutMail) Message.Resource(R.string.account_email_not_sent) else null)) }
                        // Fetch again: the server normalizes, the card shows its state.
                        fetchProfile()
                    }
                is Outcome.Failure -> declined(r)
            }
        }
    }

    /**
     * With the second factor active, the server requires a code for password and email.
     * If it's missing, the state remembers that; the UI shows the field,
     * and the next request carries it along. A wrong code leaves the field standing.
     */
    private fun declined(r: Outcome.Failure) = _accountState.update {
        it.copy(save = failed(r),
            codeNeeded = it.codeNeeded || r.code == ErrorCode.SECOND_FACTOR_NEEDED || r.code == ErrorCode.SECOND_FACTOR_WRONG)
    }

    /**
     * Change password. The server then invalidates ALL of the account's tokens, this
     * one included; that's why it goes through the app's full sign-out path afterward. The
     * explanation goes into the snackbar — the account card is gone by then.
     */
    fun changePassword(current: String, newValue: String, code: String? = null) {
        viewModelScope.launch {
            _accountState.update { it.copy(save = Operation.Running, message = null) }
            when (val r = account.changePassword(current, newValue, code?.trim()?.ifBlank { null })) {
                is Outcome.Success -> {
                    sessionService.logout()
                    messages.show(Message.Resource(R.string.account_password_changed))
                    _accountState.value = AccountUiState()
                }
                is Outcome.Failure -> declined(r)
            }
        }
    }

    // ── Account design ────────────────────────────────────────────────────

    /** With a token, /settings/theme delivers THIS account's design plus the default. */
    fun loadDesign() {
        viewModelScope.launch {
            val r = account.getAppTheme()
            if (r is Outcome.Success) _accountState.update { it.copy(design = designChoice(r.data)) }
        }
    }

    /**
     * Choose your own design; null means the admin's default. The response names
     * the effective design, and it applies right away across the whole app.
     */
    fun chooseDesign(own: Design?) {
        viewModelScope.launch {
            when (val r = account.setOwnDesign(own)) {
                is Outcome.Success -> {
                    r.data.effective?.let(session::setDesign)
                    _accountState.update { it.copy(design = designChoice(r.data), save = it.save.withoutError()) }
                }
                is Outcome.Failure -> _accountState.update { it.copy(save = failed(r)) }
            }
        }
    }

    /** Without `default` the server is older and knows no per-account design: then no choice. */
    private fun designChoice(a: DesignState) =
        a.default?.let { DesignChoice(a.effective ?: it, it, a.own) }

    /** Clear the account card's message/error once the user types on. */
    fun accountMessageRoute() = _accountState.update { it.copy(message = null, save = it.save.withoutError()) }

    // ── Signed-in devices ───────────────────────────────────────────────────

    fun loadDevices() {
        viewModelScope.launch {
            _devicesState.update { it.copy(fetch = Load.Loads) }
            when (val r = account.getTokens()) {
                is Outcome.Success -> _devicesState.update { it.copy(fetch = Load.Data(Unit), devices = r.data) }
                is Outcome.Failure -> _devicesState.update { it.copy(fetch = loadError(r)) }
            }
        }
    }

    /**
     * Opens the confirmation before signing out; [tokenId] null means all others.
     * Without a device recognized as "current", nothing is revoked — otherwise it might
     * hit one's own.
     */
    fun redeemQuestion(tokenId: String?) {
        val list = _devicesState.value.devices
        if (tokenId == null) {
            if (list.none { it.current }) {
                _devicesState.update { it.copy(fetch = Load.Failure(ErrorClass.UNKNOWN, Message.Resource(R.string.tokens_self_unknown))) }
                return
            }
            if (list.none { !it.current }) { messages.show(Message.Resource(R.string.tokens_no_others)); return }
        }
        _devicesState.update { it.copy(prompt = DevicesPrompt(tokenId), fetch = Load.Data(Unit)) }
    }

    fun cancelRedeem() = _devicesState.update { it.copy(prompt = null) }

    /** Password and, if the server demanded it, code; a refusal leaves the prompt open. */
    fun redeemConfirm(password: String, code: String?) {
        val question = _devicesState.value.prompt ?: return
        if (question.operation.running) return
        _devicesState.update { it.copy(prompt = question.copy(operation = Operation.Running)) }
        val request = Confirmation(password = password, code = code?.trim()?.ifEmpty { null })
        viewModelScope.launch {
            val error: Outcome.Failure? = if (question.tokenId != null) {
                when (val r = account.revokeToken(question.tokenId, request)) {
                    is Outcome.Success -> {
                        // deleted = 0: already gone (another device was faster) — the list is correct again after this.
                        messages.show(Message.Resource(if (r.data > 0) R.string.tokens_revoked else R.string.tokens_already_gone))
                        null
                    }
                    is Outcome.Failure -> r
                }
            } else {
                when (val r = account.endOther(request)) {
                    is Outcome.Success -> {
                        val gone = r.data
                        messages.show(Message.Quantity(R.plurals.tokens_revoked_n, gone))
                        null
                    }
                    is Outcome.Failure -> r
                }
            }
            if (error == null) {
                _devicesState.update { it.copy(prompt = null) }
                loadDevices()
            } else _devicesState.update {
                it.copy(prompt = it.prompt?.copy(operation = failed(error),
                    codeNeeded = it.prompt.codeNeeded || error.code == ErrorCode.SECOND_FACTOR_NEEDED ||
                        error.code == ErrorCode.SECOND_FACTOR_WRONG))
            }
        }
    }

    // ── Zweiter Faktor ───────────────────────────────────────────────────────

    fun loadSecondFactor() = secondFactor({ account.secondFactorStatus() }) { s, d ->
        s.copy(active = d.active, codesRemaining = d.codesRemaining)
    }

    fun setUpSecondFactorOne(password: String) = secondFactor({ account.setUpSecondFactor(password) }) { s, d ->
        s.copy(secret = d.secret, otpauth = otpauthAddress(d.otpauth))
    }

    fun confirmSecondFactor(code: String) =
        secondFactor({ account.secondFactorConfirm(code.trim()) }, R.string.zf_enabled) { s, d ->
        s.copy(active = true, codesRemaining = d.size, secret = null, otpauth = null, codes = d)
    }

    fun renewSecondFactorCodes(code: String) = secondFactor({ account.secondFactorNewCodes(code.trim()) }) { s, d ->
        s.copy(codesRemaining = d.size, codes = d)
    }

    fun disableSecondFactor(password: String, code: String) =
        secondFactor({ account.disableSecondFactor(password, code.trim()) }, R.string.zf_disabled) { _, _ ->
            SecondFactorUiState(active = false)
        }

    fun secondFactorBack() =
        _secondFactorState.update { it.copy(secret = null, otpauth = null, codes = emptyList(), fetch = Load.Data(Unit)) }

    /** A step: show loading, ask, record the result, or show an error. */
    private fun <T> secondFactor(
        fetch: suspend () -> Outcome<T>,
        successText: Int? = null,
        after: (SecondFactorUiState, T) -> SecondFactorUiState,
    ) {
        viewModelScope.launch {
            _secondFactorState.update { it.copy(fetch = Load.Loads) }
            when (val r = fetch()) {
                is Outcome.Success -> {
                    successText?.let { messages.show(Message.Resource(it)) }
                    _secondFactorState.update { after(it, r.data).copy(fetch = Load.Data(Unit)) }
                }
                is Outcome.Failure -> _secondFactorState.update { it.copy(fetch = loadError(r)) }
            }
        }
    }
}
