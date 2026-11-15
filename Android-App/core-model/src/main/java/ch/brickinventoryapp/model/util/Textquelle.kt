package ch.brickinventoryapp.model.util

/**
 * Texte aus den Ressourcen in der Sprache der App. Eine Schnittstelle ohne Android, damit
 * Zustand und ViewModels Texte bekommen, ohne selbst einen Context zu halten.
 */
interface Textquelle {
    fun text(id: Int, vararg args: Any?): String
    fun menge(id: Int, anzahl: Int, vararg args: Any?): String
}
