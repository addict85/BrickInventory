package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Zweiter Faktor im eigenen Konto — dieselben Schritte wie in der Webapp
 * (public/js/21-zweiter-faktor.js): Passwort, Schlüssel in die
 * Authenticator-App, mit einem Code bestätigen, Wiederherstellungscodes sichern.
 */

internal fun MainViewModel.ladeZweitenFaktor() {
    viewModelScope.launch {
        _zweiterFaktorState.update { it.copy(laedt = true, fehler = null) }
        when (val r = repo.admin.zweiterFaktorStand()) {
            is Result.Success -> _zweiterFaktorState.update {
                it.copy(laedt = false, aktiv = r.data.aktiv, codesUebrig = r.data.codesUebrig)
            }
            is Result.Error -> _zweiterFaktorState.update { it.copy(laedt = false, fehler = meldung(r)) }
        }
    }
}

internal fun MainViewModel.richteZweitenFaktorEin(passwort: String) {
    viewModelScope.launch {
        _zweiterFaktorState.update { it.copy(laedt = true, fehler = null) }
        when (val r = repo.admin.zweiterFaktorEinrichten(passwort)) {
            is Result.Success -> _zweiterFaktorState.update {
                it.copy(laedt = false, geheimnis = r.data.geheimnis, otpauth = r.data.otpauth)
            }
            is Result.Error -> _zweiterFaktorState.update { it.copy(laedt = false, fehler = meldung(r)) }
        }
    }
}

internal fun MainViewModel.bestaetigeZweitenFaktor(code: String) {
    viewModelScope.launch {
        _zweiterFaktorState.update { it.copy(laedt = true, fehler = null) }
        when (val r = repo.admin.zweiterFaktorBestaetigen(code.trim())) {
            is Result.Success -> {
                _snackbar.value = text(R.string.zf_enabled)
                _zweiterFaktorState.update {
                    it.copy(laedt = false, aktiv = true, codesUebrig = r.data.codes.size,
                        geheimnis = null, otpauth = null, codes = r.data.codes)
                }
            }
            is Result.Error -> _zweiterFaktorState.update { it.copy(laedt = false, fehler = meldung(r)) }
        }
    }
}

internal fun MainViewModel.erneuereZweiterFaktorCodes(code: String) {
    viewModelScope.launch {
        _zweiterFaktorState.update { it.copy(laedt = true, fehler = null) }
        when (val r = repo.admin.zweiterFaktorNeueCodes(code.trim())) {
            is Result.Success -> _zweiterFaktorState.update {
                it.copy(laedt = false, codesUebrig = r.data.codes.size, codes = r.data.codes)
            }
            is Result.Error -> _zweiterFaktorState.update { it.copy(laedt = false, fehler = meldung(r)) }
        }
    }
}

internal fun MainViewModel.schalteZweitenFaktorAb(passwort: String, code: String) {
    viewModelScope.launch {
        _zweiterFaktorState.update { it.copy(laedt = true, fehler = null) }
        when (val r = repo.admin.zweiterFaktorAbschalten(passwort, code.trim())) {
            is Result.Success -> {
                _snackbar.value = text(R.string.zf_disabled)
                _zweiterFaktorState.value = ZweiterFaktorUiState(aktiv = false)
            }
            is Result.Error -> _zweiterFaktorState.update { it.copy(laedt = false, fehler = meldung(r)) }
        }
    }
}

/** Einrichtung abbrechen oder die gezeigten Codes wegräumen. */
internal fun MainViewModel.zweiterFaktorZurueck() {
    _zweiterFaktorState.update { it.copy(geheimnis = null, otpauth = null, codes = emptyList(), fehler = null) }
}
