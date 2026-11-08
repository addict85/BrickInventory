package ch.brickinventoryapp.zustand.ui.viewmodel

/** Was die Einstellungen an der Darstellung dieses Geräts ändern. */
interface DarstellungAktionen {
    fun setLanguage(languageCode: String)
    fun setHelligkeit(wahl: String)
    fun setSystemfarben(an: Boolean)
    fun setVorschauVerbergen(an: Boolean)
    fun setWidgetWerte(an: Boolean)
}
