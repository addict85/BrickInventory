package ch.brickinventoryapp.account.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.account.ui.HouseholdUiState
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.StockReconciliation
import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The household: link accounts, invitations, unlinking.
 *
 * Who belongs and what's allowed is decided by the server
 * (utils/household.ts). Errors live in [HouseholdUiState.fetch], not in the
 * message channel: the card shows them as long as it's open.
 */
@HiltViewModel
class HouseholdViewModel @Inject constructor(
    private val session: Session,
    private val filter: FilterChoice,
    private val sync: StockReconciliation,
    private val household: HouseholdRepository,
    private val account: AccountRepository,
) : ViewModel(), FilterChoice by filter {

    val state: StateFlow<AppUiState> = session.state

    /** The time from which an invitation is valid; fixed in tests, otherwise the expiry date drifts in the image. */
    var now: () -> Long = System::currentTimeMillis

    init {
        logoutSequence(session) { reset() }
    }

    private val _householdState = MutableStateFlow(HouseholdUiState())
    val householdState: StateFlow<HouseholdUiState> = _householdState.asStateFlow()

    init {
        observeLoadOn(_householdState) { loadHousehold() }
    }

    fun loadHousehold() {
        checkSecondFactor()
        viewModelScope.launch {
            _householdState.update { it.copy(fetch = Load.Loads) }
            when (val r = household.getHousehold()) {
                is Outcome.Success -> _householdState.update { it.copy(fetch = Load.Data(Unit), status = r.data, inviteCode = null) }
                is Outcome.Failure -> _householdState.update { it.copy(fetch = loadError(r)) }
            }
        }
    }

    fun createHouseholdInvite() {
        viewModelScope.launch {
            _householdState.update { it.copy(fetch = Load.Loads) }
            when (val r = household.createHouseholdInvite()) {
                is Outcome.Success -> _householdState.update { it.copy(fetch = Load.Data(Unit), inviteCode = r.data.code,
                    inviteValidUntil = r.data.validSeconds?.let { s -> now() + s * 1000L }) }
                is Outcome.Failure -> _householdState.update { it.copy(fetch = loadError(r)) }
            }
        }
    }

    /**
     * To redeem, the server requires the current password of one's own
     * account, because linking opens one's own inventory to another
     * account; with the second factor active, also its code. On success, the
     * status reloads.
     */
    fun redeemHouseholdInvite(code: String, password: String, factorCode: String? = null) {
        viewModelScope.launch {
            _householdState.update { it.copy(fetch = Load.Loads, passwordWrong = false, factorWrong = false) }
            when (val r = household.redeemHouseholdInvite(code.trim(), password, factorCode)) {
                is Outcome.Success -> {
                    _householdState.update { it.copy(fetch = Load.Data(Unit), redeemed = it.redeemed + 1) }
                    accountsChanged(inventoryChanged = false)
                }
                // If the app doesn't know the second factor yet, only this response shows the code field.
                is Outcome.Failure -> _householdState.update { it.copy(fetch = redeemError(r),
                    passwordWrong = r.code == ErrorCode.CURRENT_PASSWORD_WRONG, factorWrong = r.code == ErrorCode.SECOND_FACTOR_WRONG,
                    factorNeeded = it.factorNeeded || r.code == ErrorCode.SECOND_FACTOR_WRONG) }
            }
        }
    }

    /** Before redeeming: if the code field is missing, the first attempt cost a failed try. */
    private fun checkSecondFactor() {
        viewModelScope.launch {
            val r = account.secondFactorStatus()
            if (r is Outcome.Success && r.data.active) _householdState.update { it.copy(factorNeeded = true) }
        }
    }

    /**
     * For the lockout after failed attempts, the server has promised no
     * dedicated code, only status 429; its message names the wait time and takes precedence.
     */
    private fun redeemError(r: Outcome.Failure): Load.Failure = when {
        r.code == ErrorCode.CURRENT_PASSWORD_WRONG -> loadError(r).copy(message = Message.Resource(R.string.household_redeem_password_wrong))
        r.code == ErrorCode.SECOND_FACTOR_WRONG -> loadError(r).copy(message = Message.Resource(R.string.household_redeem_code_wrong))
        r.code == ErrorCode.TOO_MANY_FAILED_ATTEMPTS || (r as? Outcome.Failure.Server)?.status == 429 ->
            loadError(r).copy(message = if (r.message.isBlank()) Message.Resource(R.string.household_redeem_locked) else Message.Text(r.message))
        else -> loadError(r)
    }

    /** [subUserId]: unlink a sub-account; [mainUserId]: unlink from this parent account. */
    fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null) {
        viewModelScope.launch {
            when (val r = household.unlinkHousehold(subUserId, mainUserId)) {
                is Outcome.Success -> accountsChanged(inventoryChanged = true)
                // Without a message, you tap "unlink" and visibly nothing happens.
                is Outcome.Failure -> _householdState.update { it.copy(fetch = loadError(r)) }
            }
        }
    }

    /** Hide the hint about an account that's no longer visible. */
    fun discardSeparateAccount(subUserId: Int) {
        viewModelScope.launch {
            when (val r = household.discardSeparateAccount(subUserId)) {
                is Outcome.Success -> loadHousehold()
                is Outcome.Failure -> _householdState.update { it.copy(fetch = loadError(r)) }
            }
        }
    }

    /** New accounts in the household: status, account filter and — when unlinking — the visible inventory. */
    private suspend fun accountsChanged(inventoryChanged: Boolean) {
        loadHousehold()
        filter.loadMembers()
        if (inventoryChanged) sync.stock()
    }

    private fun reset() {
        _householdState.value = HouseholdUiState()
    }
}
