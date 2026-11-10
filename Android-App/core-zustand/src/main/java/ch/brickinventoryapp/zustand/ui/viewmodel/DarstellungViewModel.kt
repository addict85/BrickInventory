package ch.brickinventoryapp.zustand.ui.viewmodel

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.zustand.ui.abgeleitet
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.zustand.ui.Sitzung
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

    // Der Zustand wird mit dem gemerkten Design geboren; ein späterer Wert käme
    // nach der ersten Komposition, und das falsche Design blitzte auf.
    init {
        sitzung.setzeDesign(prefs.gemerktesDesign())
    }

    /** Nur das Design, damit MainActivity nicht bei jeder Zustandsänderung neu komponiert. */
    val appTheme: StateFlow<Design> = sitzung.state.abgeleitet { it.appTheme }

    private val _helligkeit = MutableStateFlow(prefs.helligkeit())
    val helligkeit: StateFlow<String> = _helligkeit.asStateFlow()
    override fun setHelligkeit(wahl: String) {
        prefs.setzeHelligkeit(wahl)
        _helligkeit.value = wahl
    }

    private val _systemfarben = MutableStateFlow(prefs.systemfarben())
    val systemfarben: StateFlow<Boolean> = _systemfarben.asStateFlow()
    override fun setSystemfarben(an: Boolean) {
        prefs.setzeSystemfarben(an)
        _systemfarben.value = an
    }

    /** FLAG_SECURE für die ganze App, über den Zähler von Sichtschutz. */
    private val _vorschauVerbergen = MutableStateFlow(prefs.vorschauVerbergen())
    val vorschauVerbergen: StateFlow<Boolean> = _vorschauVerbergen.asStateFlow()
    override fun setVorschauVerbergen(an: Boolean) {
        prefs.setzeVorschauVerbergen(an)
        _vorschauVerbergen.value = an
    }

    /** Geldwerte im Startbildschirm-Widget; es liegt ohne Entsperren offen. */
    private val _widgetWerte = MutableStateFlow(prefs.widgetWerteZeigen())
    val widgetWerte: StateFlow<Boolean> = _widgetWerte.asStateFlow()
    override fun setWidgetWerte(an: Boolean) {
        prefs.setzeWidgetWerteZeigen(an)
        _widgetWerte.value = an
        viewModelScope.launch { fangeAusserAbbruch { widget.aktualisiere() } }
    }

    override fun setLanguage(languageCode: String) {
        viewModelScope.launch {
            prefs.saveLanguage(languageCode)
            LanguageManager.applyLanguage(languageCode)
        }
    }
}
