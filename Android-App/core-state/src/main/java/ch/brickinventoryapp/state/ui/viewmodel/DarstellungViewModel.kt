package ch.brickinventoryapp.state.ui.viewmodel

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.session.abgeleitet
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.state.ui.Widgetanstoss
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * How the app looks on this device: theme, brightness, system colors,
 * privacy screen, widget values and language. On the activity, because MainActivity builds
 * the theme from it and settings change the same instance.
 */
@HiltViewModel
class DarstellungViewModel @Inject constructor(
    private val prefs: Darstellungsablage,
    sitzung: Sitzung,
    private val widget: Widgetanstoss,
) : ViewModel(), DarstellungAktionen {

    /**
     * Only the theme, so MainActivity doesn't recompose on every state change.
     * The first value comes from the store's synchronous mirror (Kontowerte), before the first frame.
     */
    val appTheme: StateFlow<Design> = sitzung.state.abgeleitet { it.appTheme }

    private val _brightness = MutableStateFlow(prefs.helligkeit())
    val helligkeit: StateFlow<String> = _brightness.asStateFlow()
    override fun setHelligkeit(wahl: String) {
        prefs.setzeHelligkeit(wahl)
        _brightness.value = wahl
    }

    private val _systemfarben = MutableStateFlow(prefs.systemfarben())
    val systemfarben: StateFlow<Boolean> = _systemfarben.asStateFlow()
    override fun setSystemfarben(an: Boolean) {
        prefs.setzeSystemfarben(an)
        _systemfarben.value = an
    }

    /** FLAG_SECURE for the whole app, via the privacy-screen counter. */
    private val _hidePreview = MutableStateFlow(prefs.hidePreview())
    val hidePreview: StateFlow<Boolean> = _hidePreview.asStateFlow()
    override fun setVorschauVerbergen(an: Boolean) {
        prefs.setzeVorschauVerbergen(an)
        _hidePreview.value = an
    }

    /** Monetary values in the home-screen widget; it sits exposed without unlocking. */
    private val _widgetValues = MutableStateFlow(prefs.showWidgetValues())
    val widgetValues: StateFlow<Boolean> = _widgetValues.asStateFlow()
    override fun setWidgetValues(an: Boolean) {
        prefs.showSetWidgetValues(an)
        _widgetValues.value = an
        viewModelScope.launch { fangeAusserAbbruch { widget.refresh() } }
    }

    override fun setLanguage(languageCode: String) {
        viewModelScope.launch {
            prefs.saveLanguage(languageCode)
            LanguageManager.applyLanguage(languageCode)
        }
    }
}
