package ch.brickinventoryapp.data.util

import java.util.Base64

/**
 * Pins und den Nutzer-CA-Schalter verschlüsselt in den SharedPreferences ablegen. Eigener
 * Schlüssel, nicht der Ablageschlüssel: Der wird beim Abmelden erneuert, ein Pin gilt aber
 * dem Server, nicht dem Konto. Jeder Fehler (Keystore gesperrt, Wert verändert, unter
 * fremdem Namen abgelegt) ergibt null — der Aufrufer fällt dann auf „nicht vertraut“ zurück.
 */
class Vertrauenschiffre(schluessel: () -> ByteArray) {
    private val chiffre = AblageChiffre(schluessel)

    fun verschluessle(wert: String, bindung: String): String? = runCatching {
        Base64.getEncoder().encodeToString(chiffre.verschluessle(wert.toByteArray(Charsets.UTF_8), ZWECK + bindung))
    }.getOrNull()

    fun entschluessle(gespeichert: String, bindung: String): String? = runCatching {
        chiffre.entschluessle(Base64.getDecoder().decode(gespeichert), ZWECK + bindung)?.toString(Charsets.UTF_8)
    }.getOrNull()

    private companion object {
        const val ZWECK = "vertrauen:"
    }
}
