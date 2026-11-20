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
 * Der Haushalt: Konten verknüpfen, Einladungen, Lösen.
 *
 * Wer dazugehört und was erlaubt ist, entscheidet der Server
 * (utils/household.ts). Fehler stehen in [HouseholdUiState.abruf] und nicht im
 * Meldungskanal: Die Karte zeigt sie, solange sie offen ist.
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

    /** Die Zeit, ab der eine Einladung gilt; in Tests fest, sonst wandert das Ablaufdatum im Bild. */
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
     * Der Server verlangt zum Einlösen das aktuelle Passwort des eigenen
     * Kontos, denn die Verknüpfung öffnet den eigenen Bestand einem anderen
     * Konto; bei aktivem zweitem Faktor auch dessen Code. Bei Erfolg lädt der
     * Status neu.
     */
    fun redeemHouseholdInvite(code: String, passwort: String, faktorCode: String? = null) {
        viewModelScope.launch {
            _householdState.update { it.copy(abruf = Laden.Loads, passwordWrong = false, factorWrong = false) }
            when (val r = haushalt.redeemHouseholdInvite(code.trim(), passwort, faktorCode)) {
                is Ergebnis.Erfolg -> {
                    _householdState.update { it.copy(abruf = Laden.Daten(Unit), eingeloest = it.eingeloest + 1) }
                    accountsChanged(inventoryChanged = false)
                }
                // Kennt die App den zweiten Faktor noch nicht, zeigt erst diese Antwort das Codefeld.
                is Ergebnis.Fehler -> _householdState.update { it.copy(abruf = redeemError(r),
                    passwordWrong = r.code == Fehlercode.AKTUELLES_PASSWORT_FALSCH, factorWrong = r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH,
                    factorNeeded = it.factorNeeded || r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH) }
            }
        }
    }

    /** Vor dem Einlösen: Fehlt das Codefeld, kostete der erste Versuch einen Fehlversuch. */
    private fun checkSecondFactor() {
        viewModelScope.launch {
            val r = konto.secondFactorStatus()
            if (r is Ergebnis.Erfolg && r.data.aktiv) _householdState.update { it.copy(factorNeeded = true) }
        }
    }

    /**
     * Für die Sperre nach Fehlversuchen hat der Server keinen eigenen Code
     * zugesagt, nur den Status 429; sein Satz nennt die Wartezeit und geht vor.
     */
    private fun redeemError(r: Ergebnis.Fehler): Laden.Fehler = when {
        r.code == Fehlercode.AKTUELLES_PASSWORT_FALSCH -> loadError(r).copy(meldung = Meldung.Resource(R.string.household_redeem_password_wrong))
        r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH -> loadError(r).copy(meldung = Meldung.Resource(R.string.household_redeem_code_wrong))
        r.code == Fehlercode.ZU_VIELE_FEHLVERSUCHE || (r as? Ergebnis.Fehler.Server)?.status == 429 ->
            loadError(r).copy(meldung = if (r.message.isBlank()) Meldung.Resource(R.string.household_redeem_locked) else Meldung.Text(r.message))
        else -> loadError(r)
    }

    /** [subUserId]: Unterkonto lösen; [mainUserId]: sich von diesem Elternkonto lösen. */
    fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null) {
        viewModelScope.launch {
            when (val r = haushalt.unlinkHousehold(subUserId, mainUserId)) {
                is Ergebnis.Erfolg -> accountsChanged(inventoryChanged = true)
                // Ohne Meldung tippt man auf „lösen“, und sichtbar geschieht nichts.
                is Ergebnis.Fehler -> _householdState.update { it.copy(abruf = loadError(r)) }
            }
        }
    }

    /** Den Hinweis auf ein nicht mehr sichtbares Konto ausblenden. */
    fun discardSeparateAccount(subUserId: Int) {
        viewModelScope.launch {
            when (val r = haushalt.discardSeparateAccount(subUserId)) {
                is Ergebnis.Erfolg -> loadHousehold()
                is Ergebnis.Fehler -> _householdState.update { it.copy(abruf = loadError(r)) }
            }
        }
    }

    /** Neue Konten im Haushalt: Status, Kontofilter und — beim Lösen — der sichtbare Bestand. */
    private suspend fun accountsChanged(inventoryChanged: Boolean) {
        loadHousehold()
        filter.loadMembers()
        if (inventoryChanged) sync.bestand()
    }

    private fun reset() {
        _householdState.value = HouseholdUiState()
    }
}
