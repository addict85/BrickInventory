package ch.brickinventoryapp.konto.ui.viewmodel

import ch.brickinventoryapp.model.ui.model.alsAnsicht
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.data.model.Fehlercode
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.konto.ui.HouseholdUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung

/**
 * Der Haushalt: Konten verknüpfen, Einladungen, Lösen.
 *
 * Wer dazugehört und was erlaubt ist, entscheidet der Server
 * (utils/household.ts). Meldungen stehen in [HouseholdUiState.message] und
 * nicht im Meldungskanal: Die Karte zeigt sie, solange sie offen ist.
 */
@HiltViewModel
class HaushaltViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val abgleich: Bestandsabgleich,
    private val haushalt: HaushaltRepository,
    private val konto: KontoRepository,
) : ViewModel(), Filterwahl by filter {

    val state: StateFlow<AppUiState> = sitzung.state

    /** Die Zeit, ab der eine Einladung gilt; in Tests fest, sonst wandert das Ablaufdatum im Bild. */
    var jetzt: () -> Long = System::currentTimeMillis

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
    }

    private val _householdState = MutableStateFlow(HouseholdUiState())
    val householdState: StateFlow<HouseholdUiState> = _householdState.asStateFlow()

    fun loadHouseholdStatus() {
        pruefeZweitenFaktor()
        viewModelScope.launch {
            _householdState.update { it.copy(isLoading = true, message = null) }
            when (val r = haushalt.getHousehold()) {
                is Ergebnis.Success -> _householdState.update { it.copy(isLoading = false, status = r.data.alsAnsicht(), inviteCode = null) }
                is Ergebnis.Error -> _householdState.update { it.copy(isLoading = false, message = meldungen.meldung(r)) }
            }
        }
    }

    fun createHouseholdInvite() {
        viewModelScope.launch {
            _householdState.update { it.copy(isLoading = true, message = null) }
            when (val r = haushalt.createHouseholdInvite()) {
                is Ergebnis.Success ->
                    if (r.data.success) _householdState.update { it.copy(isLoading = false, inviteCode = r.data.code,
                        inviteGueltigBis = r.data.expiresIn?.let { s -> jetzt() + s * 1000L }) }
                    else _householdState.update { it.copy(isLoading = false, message = r.data.error) }
                is Ergebnis.Error -> _householdState.update { it.copy(isLoading = false, message = meldungen.meldung(r)) }
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
            _householdState.update { it.copy(isLoading = true, message = null, passwortFalsch = false, faktorFalsch = false) }
            when (val r = haushalt.redeemHouseholdInvite(code.trim(), passwort, faktorCode)) {
                is Ergebnis.Success -> {
                    _householdState.update { it.copy(isLoading = false, message = r.data.error,
                        eingeloest = if (r.data.success) it.eingeloest + 1 else it.eingeloest) }
                    if (r.data.success) kontenGeaendert(bestandGeaendert = false)
                }
                // Kennt die App den zweiten Faktor noch nicht, zeigt erst diese Antwort das Codefeld.
                is Ergebnis.Error -> _householdState.update { it.copy(isLoading = false,
                    passwortFalsch = r.code == Fehlercode.AKTUELLES_PASSWORT_FALSCH, faktorFalsch = r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH,
                    faktorNoetig = it.faktorNoetig || r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH, message = einloeseFehler(r)) }
            }
        }
    }

    /** Vor dem Einlösen: Fehlt das Codefeld, kostete der erste Versuch einen Fehlversuch. */
    private fun pruefeZweitenFaktor() {
        viewModelScope.launch {
            val r = konto.zweiterFaktorStand()
            if (r is Ergebnis.Success && r.data.aktiv) _householdState.update { it.copy(faktorNoetig = true) }
        }
    }

    /**
     * Für die Sperre nach Fehlversuchen hat der Server keinen eigenen Code
     * zugesagt, nur den Status 429; sein Satz nennt die Wartezeit und geht vor.
     */
    private fun einloeseFehler(r: Ergebnis.Error): String = when {
        r.code == Fehlercode.AKTUELLES_PASSWORT_FALSCH -> meldungen.text(R.string.household_redeem_password_wrong)
        r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH -> meldungen.text(R.string.household_redeem_code_wrong)
        r.code == Fehlercode.ZU_VIELE_FEHLVERSUCHE || (r as? Ergebnis.Error.Server)?.status == 429 ->
            r.message.ifBlank { meldungen.text(R.string.household_redeem_locked) }
        else -> meldungen.meldung(r)
    }

    /** [subUserId]: Unterkonto lösen; [mainUserId]: sich von diesem Elternkonto lösen. */
    fun unlinkHousehold(subUserId: Int? = null, mainUserId: Int? = null) {
        viewModelScope.launch {
            when (val r = haushalt.unlinkHousehold(subUserId, mainUserId)) {
                is Ergebnis.Success -> kontenGeaendert(bestandGeaendert = true)
                // Ohne Meldung tippt man auf „lösen“, und sichtbar geschieht nichts.
                is Ergebnis.Error -> _householdState.update { it.copy(message = meldungen.meldung(r)) }
            }
        }
    }

    /** Den Hinweis auf ein nicht mehr sichtbares Konto ausblenden. */
    fun verwerfeGetrenntesKonto(subUserId: Int) {
        viewModelScope.launch {
            when (val r = haushalt.verwerfeGetrenntesKonto(subUserId)) {
                is Ergebnis.Success -> loadHouseholdStatus()
                is Ergebnis.Error -> _householdState.update { it.copy(message = meldungen.meldung(r)) }
            }
        }
    }

    /** Neue Konten im Haushalt: Status, Kontofilter und — beim Lösen — der sichtbare Bestand. */
    private suspend fun kontenGeaendert(bestandGeaendert: Boolean) {
        loadHouseholdStatus()
        filter.ladeMitglieder()
        if (bestandGeaendert) abgleich.bestand()
    }

    private fun zuruecksetzen() {
        _householdState.value = HouseholdUiState()
    }
}
