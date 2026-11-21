package ch.brickinventoryapp.account.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.domain.Fehlercode
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.account.ui.HouseholdUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn

/**
 * The household: link accounts, invitations, unlinking.
 *
 * Who belongs and what's allowed is decided by the server
 * (utils/household.ts). Errors live in [HouseholdUiState.abruf], not in the
 * message channel: the card shows them as long as it's open.
 */
@HiltViewModel
class HouseholdViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val sync: Bestandsabgleich,
    private val haushalt: HouseholdRepository,
    private val konto: AccountRepository,
) : ViewModel(), Filterwahl by filter {

    val state: StateFlow<AppUiState> = sitzung.state

    /** The time from which an invitation is valid; fixed in tests, otherwise the expiry date drifts in the image. */
    var jetzt: () -> Long = System::currentTimeMillis

    init {
        sequenceSignOut(sitzung) { reset() }
    }

    private val _householdState = MutableStateFlow(HouseholdUiState())
    val householdState: StateFlow<HouseholdUiState> = _householdState.asStateFlow()

    init {
        observeLoadOn(_householdState) { loadHousehold() }
    }

    fun loadHousehold() {
        checkSecondFactor()
        viewModelScope.launch {
            _householdState.update { it.copy(abruf = Laden.Loads) }
            when (val r = haushalt.getHousehold()) {
                is Ergebnis.Erfolg -> _householdState.update { it.copy(abruf = Laden.Daten(Unit), status = r.data, inviteCode = null) }
                is Ergebnis.Fehler -> _householdState.update { it.copy(abruf = loadError(r)) }
            }
        }
    }

    fun createHouseholdInvite() {
        viewModelScope.launch {
            _householdState.update { it.copy(abruf = Laden.Loads) }
            when (val r = haushalt.createHouseholdInvite()) {
                is Ergebnis.Erfolg -> _householdState.update { it.copy(abruf = Laden.Daten(Unit), inviteCode = r.data.code,
                    inviteValidUntil = r.data.validSeconds?.let { s -> jetzt() + s * 1000L }) }
                is Ergebnis.Fehler -> _householdState.update { it.copy(abruf = loadError(r)) }
            }
        }
    }

    /**
     * To redeem, the server requires the current password of one's own
     * account, because linking opens one's own inventory to another
     * account; with the second factor active, also its code. On success, the
     * status reloads.
     */
    fun redeemHouseholdInvite(code: String, passwort: String, faktorCode: String? = null) {
        viewModelScope.launch {
            _householdState.update { it.copy(abruf = Laden.Loads, passwordWrong = false, factorWrong = false) }
            when (val r = haushalt.redeemHouseholdInvite(code.trim(), passwort, faktorCode)) {
                is Ergebnis.Erfolg -> {
                    _householdState.update { it.copy(abruf = Laden.Daten(Unit), eingeloest = it.eingeloest + 1) }
                    accountsChanged(inventoryChanged = false)
                }
                // If the app doesn't know the second factor yet, only this response shows the code field.
                is Ergebnis.Fehler -> _householdState.update { it.copy(abruf = redeemError(r),
                    passwordWrong = r.code == Fehlercode.AKTUELLES_PASSWORT_FALSCH, factorWrong = r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH,
                    factorNeeded = it.factorNeeded || r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH) }
            }
        }
    }

    /** Before redeeming: if the code field is missing, the first attempt cost a failed try. */
    private fun checkSecondFactor() {
        viewModelScope.launch {
            val r = konto.secondFactorStatus()
            if (r is Ergebnis.Erfolg && r.data.aktiv) _householdState.update { it.copy(factorNeeded = true) }
        }
    }

    /**
     * For the lockout after failed attempts, the server has promised no
     * dedicated code, only status 429; its message names the wait time and takes precedence.
     */
    private fun redeemError(r: Ergebnis.Fehler): Laden.Fehler = when {
        r.code == Fehlercode.AKTUELLES_PASSWORT_FALSCH -> loadError(r).copy(meldung = Meldung.Resource(R.string.household_redeem_password_wrong))
        r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH -> loadError(r).copy(meldung = Meldung.Resource(R.string.household_redeem_code_wrong))
        r.code == Fehlercode.ZU_VIELE_FEHLVERSUCHE || (r as? Ergebnis.Fehler.Server)?.status == 429 ->
            loadError(r).copy(meldung = if (r.message.isBlank()) Meldung.Resource(R.string.household_redeem_locked) else Meldung.Text(r.message))
        else -> loadError(r)
    }

    /** [subUserId]: unlink a sub-account; [mainUserId]: unlink from this parent account. */
    fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null) {
        viewModelScope.launch {
            when (val r = haushalt.unlinkHousehold(subUserId, mainUserId)) {
                is Ergebnis.Erfolg -> accountsChanged(inventoryChanged = true)
                // Without a message, you tap "unlink" and visibly nothing happens.
                is Ergebnis.Fehler -> _householdState.update { it.copy(abruf = loadError(r)) }
            }
        }
    }

    /** Hide the hint about an account that's no longer visible. */
    fun discardSeparateAccount(subUserId: Int) {
        viewModelScope.launch {
            when (val r = haushalt.discardSeparateAccount(subUserId)) {
                is Ergebnis.Erfolg -> loadHousehold()
                is Ergebnis.Fehler -> _householdState.update { it.copy(abruf = loadError(r)) }
            }
        }
    }

    /** New accounts in the household: status, account filter and — when unlinking — the visible inventory. */
    private suspend fun accountsChanged(inventoryChanged: Boolean) {
        loadHousehold()
        filter.loadMembers()
        if (inventoryChanged) sync.bestand()
    }

    private fun reset() {
        _householdState.value = HouseholdUiState()
    }
}
