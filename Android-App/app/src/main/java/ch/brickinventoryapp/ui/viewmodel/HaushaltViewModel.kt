package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.HouseholdUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Der Haushalt: Konten verknüpfen, Einladungen, Lösen.
 *
 * Wer dazugehört und was erlaubt ist, entscheidet der Server
 * (utils/household.ts). Meldungen stehen in [HouseholdUiState.message] und
 * nicht im Meldungskanal: Die Karte zeigt sie, solange sie offen ist.
 */
@HiltViewModel
class HaushaltViewModel @Inject constructor(
    dienste: AppDienste,
    private val haushalt: HaushaltRepository,
) : BereichsViewModel(dienste) {

    private val _householdState = MutableStateFlow(HouseholdUiState())
    val householdState: StateFlow<HouseholdUiState> = _householdState.asStateFlow()

    fun loadHouseholdStatus() {
        viewModelScope.launch {
            _householdState.update { it.copy(isLoading = true, message = null) }
            when (val r = haushalt.getHousehold()) {
                is Result.Success -> _householdState.update { it.copy(isLoading = false, status = r.data, inviteCode = null) }
                is Result.Error -> _householdState.update { it.copy(isLoading = false, message = meldung(r)) }
            }
        }
    }

    fun createHouseholdInvite() {
        viewModelScope.launch {
            _householdState.update { it.copy(isLoading = true, message = null) }
            when (val r = haushalt.createHouseholdInvite()) {
                is Result.Success ->
                    if (r.data.success) _householdState.update { it.copy(isLoading = false, inviteCode = r.data.code) }
                    else _householdState.update { it.copy(isLoading = false, message = r.data.error) }
                is Result.Error -> _householdState.update { it.copy(isLoading = false, message = meldung(r)) }
            }
        }
    }

    /**
     * Der Server verlangt zum Einlösen das aktuelle Passwort des eigenen
     * Kontos, denn die Verknüpfung öffnet den eigenen Bestand einem anderen
     * Konto. Bei Erfolg lädt der Status neu.
     */
    fun redeemHouseholdInvite(code: String, passwort: String) {
        viewModelScope.launch {
            _householdState.update { it.copy(isLoading = true, message = null, passwortFalsch = false) }
            when (val r = haushalt.redeemHouseholdInvite(code.trim(), passwort)) {
                is Result.Success -> {
                    _householdState.update { it.copy(isLoading = false, message = r.data.error,
                        eingeloest = if (r.data.success) it.eingeloest + 1 else it.eingeloest) }
                    if (r.data.success) kontenGeaendert(bestand = false)
                }
                is Result.Error -> _householdState.update { it.copy(isLoading = false,
                    passwortFalsch = r.code == PASSWORT_FALSCH, message = einloeseFehler(r)) }
            }
        }
    }

    /**
     * Für die Sperre nach Fehlversuchen hat der Server keinen eigenen Code
     * zugesagt, nur den Status 429; sein Satz nennt die Wartezeit und geht vor.
     */
    private fun einloeseFehler(r: Result.Error): String = when {
        r.code == PASSWORT_FALSCH -> text(R.string.household_redeem_password_wrong)
        r.code == "zu_viele_fehlversuche" || r.httpCode == 429 ->
            r.message.ifBlank { text(R.string.household_redeem_locked) }
        else -> meldung(r)
    }

    /** [subUserId]: Unterkonto lösen; [mainUserId]: sich von diesem Elternkonto lösen. */
    fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null) {
        viewModelScope.launch {
            when (val r = haushalt.unlinkHousehold(subUserId, mainUserId)) {
                is Result.Success -> kontenGeaendert(bestand = true)
                // Ohne Meldung tippt man auf „lösen“, und sichtbar geschieht nichts.
                is Result.Error -> _householdState.update { it.copy(message = meldung(r)) }
            }
        }
    }

    /** Den Hinweis auf ein nicht mehr sichtbares Konto ausblenden. */
    fun verwerfeGetrenntesKonto(subUserId: Int) {
        viewModelScope.launch {
            when (val r = haushalt.verwerfeGetrenntesKonto(subUserId)) {
                is Result.Success -> loadHouseholdStatus()
                is Result.Error -> _householdState.update { it.copy(message = meldung(r)) }
            }
        }
    }

    /** Neue Konten im Haushalt: Status, Kontofilter und — beim Lösen — der sichtbare Bestand. */
    private suspend fun kontenGeaendert(bestand: Boolean) {
        loadHouseholdStatus()
        dienste.blickfeld.ladeMitglieder()
        if (bestand) dienste.bestand.melde(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren)
    }

    override fun zuruecksetzen() {
        _householdState.value = HouseholdUiState()
    }

    private companion object {
        const val PASSWORT_FALSCH = "aktuelles_passwort_falsch"
    }
}
