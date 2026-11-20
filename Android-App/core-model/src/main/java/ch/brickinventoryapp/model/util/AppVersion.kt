package ch.brickinventoryapp.model.util

/**
 * Name und Code der laufenden App-Fassung. Nur das App-Modul kennt seine
 * BuildConfig; die Bereiche bekommen die Werte über Hilt (ViewModels) und
 * LocalAppVersion (Oberfläche).
 */

data class AppVersion(val name: String, val code: Int)
