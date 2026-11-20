package ch.brickinventoryapp.ui.components

import java.security.PublicKey
import java.security.Signature

/** Was die App-Sperre vom Keystore braucht; im Test steht ein Software-Schlüssel dafür. */
internal interface Entsperrschluessel {
    fun signatur(): Signature
    fun oeffentlich(): PublicKey
    fun discard()
}

/**
 * Die App-Sperre fällt erst nach einem Krypto-Vorgang: Die vom Prompt freigegebene
 * Signatur muss eine frische Zufallszahl passend zum öffentlichen Schlüssel signieren —
 * ein eingehakter Erfolgsrückruf ohne echte Freigabe scheitert an sign(). Kann sie nicht
 * signieren (Schlüssel inzwischen ungültig), gibt es einen neuen und genau eine Rückfrage mehr.
 */
internal class AppUnlocking(
    private val schluessel: Entsperrschluessel,
    private val frage: (Signature, (Signature?) -> Unit) -> Unit,
) {
    private val freigabe = Schrittfreigabe(schluessel::oeffentlich)

    fun unlock(weiter: () -> Unit) = versuche(weiter, again = true)

    private fun versuche(weiter: () -> Unit, again: Boolean) {
        // Ohne Schlüssel bleibt die App gesperrt; der Knopf auf dem Sperrschirm fragt erneut.
        val signatur = runCatching { schluessel.signatur() }.getOrNull() ?: return
        frage(signatur) { released ->
            when {
                freigabe.gilt(released) -> weiter()
                released != null && again -> {
                    runCatching { schluessel.discard() }
                    versuche(weiter, again = false)
                }
            }
        }
    }
}
