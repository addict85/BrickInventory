package ch.brickinventoryapp.state.ui.viewmodel

/** What the settings change about this device's appearance. */
interface AppearanceActions {
    fun setLanguage(languageCode: String)
    fun setBrightness(choice: String)
    fun setSystemColors(an: Boolean)
    fun setPreviewHidden(an: Boolean)
    fun setWidgetValues(an: Boolean)
}
