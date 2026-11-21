package ch.brickinventoryapp.state.ui.viewmodel

/** What the settings change about this device's appearance. */
interface DarstellungAktionen {
    fun setLanguage(languageCode: String)
    fun setHelligkeit(wahl: String)
    fun setSystemfarben(an: Boolean)
    fun setVorschauVerbergen(an: Boolean)
    fun setWidgetValues(an: Boolean)
}
