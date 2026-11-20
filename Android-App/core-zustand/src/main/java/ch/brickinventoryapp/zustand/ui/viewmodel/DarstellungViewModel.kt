package ch.brickinventoryapp.zustand.ui.viewmodel

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.sitzung.abgeleitet
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.zustand.ui.Widgetanstoss
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Wie die App auf diesem Gerät aussieht: Design, Helligkeit, Systemfarben,
 * Sichtschutz, Widget-Werte und Sprache. An der Activity, weil MainActivity das
 * Thema daraus baut und die Einstellungen dieselbe Instanz ändern.
 */
@HiltViewModel
class DarstellungViewModel @Inject constructor(
    private val prefs: Darstellungsablage,
    sitzung: Sitzung,
    private val widget: Widgetanstoss,
) : ViewModel(), DarstellungAktionen {

    /**
     * Nur das Design, damit MainActivity nicht bei jeder Zustandsänderung neu komponiert.
     * Den ersten Wert liefert der synchrone Spiegel der Ablage (Kontowerte), vor dem ersten Bild.
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

    /** FLAG_SECURE für die ganze App, über den Zähler von Sichtschutz. */
    private val _hidePreview = MutableStateFlow(prefs.hidePreview())
    val hidePreview: StateFlow<Boolean> = _hidePreview.asStateFlow()
    override fun setVorschauVerbergen(an: Boolean) {
        prefs.setzeVorschauVerbergen(an)
        _hidePreview.value = an
    }

    /** Geldwerte im Startbildschirm-Widget; es liegt ohne Entsperren offen. */
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
