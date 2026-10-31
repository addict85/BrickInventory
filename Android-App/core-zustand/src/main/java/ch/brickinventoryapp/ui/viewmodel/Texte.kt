package ch.brickinventoryapp.ui.viewmodel

import android.net.Uri
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.util.meldetDieSitzungsschicht

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
    fun meldung(fehler: Result.Error): String
    /** Null heisst: Die Sitzungsschicht hat den Fehler schon gemeldet. */
    fun meldungFuerSnackbar(fehler: Result.Error): String? =
        if (meldetDieSitzungsschicht(fehler.unauthorized, angemeldet())) null else meldung(fehler)
    /** Liegt ein Token vor? Dieselbe Quelle, die der Interceptor liest. */
    fun angemeldet(): Boolean
}

/** Liest eine vom Nutzer gewählte Datei: Medientyp und Inhalt, oder null. */
interface DateiLeser {
    suspend fun lies(uri: Uri): Pair<String?, ByteArray>?
    /** Der angezeigte Dateiname, oder null, wenn ihn die Quelle nicht nennt. */
    suspend fun name(uri: Uri): String? = null
}
