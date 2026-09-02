package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch


/**
 * Einstellungen: Laden, Sprache (per-App-Locale) und Speichern
 * (Währung/Zustand) — Feature-Modul des MainViewModel, siehe README
 * in den anderen *Feature.kt-Dateien.
 */

internal fun MainViewModel.loadSettings() {
    viewModelScope.launch {
        when (val r = repo.admin.getSettings()) {
            is Result.Success -> _state.update { it.copy(
                currency = r.data.settings.currency,
                priceCondition = r.data.settings.priceCondition,
                defaultPriceCondition = r.data.settings.defaultPriceCondition,
                userDefaultCondition = r.data.settings.effectiveCondition, // server-resolved effective value
                appTheme = r.data.settings.appTheme
            )}
            is Result.Error -> {}
        }
    }
}

internal fun MainViewModel.setLanguage(languageCode: String) {
    viewModelScope.launch {
        prefs.saveLanguage(languageCode)
        ch.brickinventoryapp.util.LanguageManager.applyLanguage(languageCode)
    }
}

internal fun MainViewModel.saveSettings(currency: String, condition: String) {
    viewModelScope.launch {
        when (val r = repo.admin.updateSettings(currency, condition)) {
            is Result.Success -> {
                _snackbar.value = text(ch.brickinventoryapp.R.string.vm_settings_saved)
                _state.update { it.copy(currency = currency, priceCondition = condition) }
                // Währung und Preiszustand bestimmen, welche Preise der Server
                // liefert. Ohne Nachladen zeigte die App die alten Werte mit dem
                // NEUEN Währungszeichen — also schlicht falsche Beträge, bis der
                // jeweilige Reiter neu geöffnet wurde.
                loadSets()
                loadValuation()
                loadStats()
            }
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

internal fun MainViewModel.saveUserDefaultCondition(condition: String) {
    viewModelScope.launch {
        when (val r = repo.teile.setUserDefaultCondition(condition)) {
            is Result.Success -> loadSettings() // effective default in State aktualisieren
            is Result.Error   -> _snackbar.value = text(R.string.vm_error, meldung(r))
        }
    }
}
