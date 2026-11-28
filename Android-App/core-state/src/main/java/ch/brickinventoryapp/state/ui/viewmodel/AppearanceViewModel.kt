package ch.brickinventoryapp.state.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.AppearanceStore
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.WidgetKick
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * How the app looks on this device: theme, brightness, system colors,
 * privacy screen, widget values and language. On the activity, because MainActivity builds
 * the theme from it and settings change the same instance.
 */
@HiltViewModel
class AppearanceViewModel @Inject constructor(
    private val prefs: AppearanceStore,
    session: Session,
    private val widget: WidgetKick,
) : ViewModel(), AppearanceActions {

    /**
     * Only the theme, so MainActivity doesn't recompose on every state change.
     * The first value comes from the store's synchronous mirror (AccountValues), before the first frame.
     */
    val appTheme: StateFlow<Design> =
        session.state.map { it.appTheme }.stateIn(viewModelScope, SharingStarted.Eagerly, session.state.value.appTheme)

    private val _brightness = MutableStateFlow(prefs.brightness())
    val brightness: StateFlow<String> = _brightness.asStateFlow()
    override fun setBrightness(choice: String) {
        prefs.applyBrightness(choice)
        _brightness.value = choice
    }

    private val _systemColors = MutableStateFlow(prefs.systemColors())
    val systemColors: StateFlow<Boolean> = _systemColors.asStateFlow()
    override fun setSystemColors(an: Boolean) {
        prefs.applySystemColors(an)
        _systemColors.value = an
    }

    /** FLAG_SECURE for the whole app, via the privacy-screen counter. */
    private val _hidePreview = MutableStateFlow(prefs.hidePreview())
    val hidePreview: StateFlow<Boolean> = _hidePreview.asStateFlow()
    override fun setPreviewHidden(an: Boolean) {
        prefs.applyPreviewHidden(an)
        _hidePreview.value = an
    }

    /** Monetary values in the home-screen widget; it sits exposed without unlocking. */
    private val _widgetValues = MutableStateFlow(prefs.showWidgetValues())
    val widgetValues: StateFlow<Boolean> = _widgetValues.asStateFlow()
    override fun setWidgetValues(an: Boolean) {
        prefs.showSetWidgetValues(an)
        _widgetValues.value = an
        viewModelScope.launch { catchUnlessCancelled { widget.refresh() } }
    }

    override fun setLanguage(languageCode: String) {
        viewModelScope.launch {
            prefs.saveLanguage(languageCode)
            LanguageManager.applyLanguage(languageCode)
        }
    }
}
