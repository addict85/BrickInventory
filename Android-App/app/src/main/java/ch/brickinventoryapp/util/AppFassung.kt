package ch.brickinventoryapp.util

/**
 * Name und Code der laufenden App-Fassung. Nur das App-Modul kennt seine
 * BuildConfig; die Bereiche bekommen die Werte über Hilt (ViewModels) und
 * LocalAppFassung (Oberfläche).
 */
data class AppFassung(val name: String, val code: Int)
