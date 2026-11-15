package ch.brickinventoryapp.zustand.ui.viewmodel

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.netz.util.meldetDieSitzungsschicht

/**
 * Texte und Fehlermeldungen für die herausgelösten ViewModels.
 *
 * Eine Schnittstelle statt des Contexts, damit sich ein ViewModel ohne Gerät
 * bauen und ausführen lässt: Der Test reicht eine Fassung herein, die die
 * Ressourcennummer zurückgibt. Die Fassung für das Gerät ist AppTexte.
 */
interface Texte {
    fun text(id: Int, vararg args: Any?): String
    fun menge(id: Int, anzahl: Int, vararg args: Any?): String
    /** Für Fehlerfelder in Formularen — dort ist „nichts zu sagen" keine Antwort. */
    fun meldung(fehler: Ergebnis.Fehler): String
    /** Null heisst: Die Sitzungsschicht hat den Fehler schon gemeldet. */
    fun meldungFuerSnackbar(fehler: Ergebnis.Fehler): String? =
        if (meldetDieSitzungsschicht(fehler is Ergebnis.Fehler.Abgewiesen, angemeldet())) null else meldung(fehler)
    /** Liegt ein Token vor? Dieselbe Quelle, die der Interceptor liest. */
    fun angemeldet(): Boolean
}
