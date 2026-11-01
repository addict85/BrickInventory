package ch.brickinventoryapp.util

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Bevor der Token unverschlüsselt in ein Netz geht, muss sich der Server
 * ausweisen: Im fremden WLAN kann "http://nas:3000" auf einen anderen Rechner
 * zeigen. Nur der echte Server kennt den Hash des Tokens und kann damit eine
 * Zufallszahl unterschreiben (POST /api/v1/auth/serverbeweis).
 */
object ServerBeweis {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    fun tokenHash(token: String): String =
        hex(MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)))

    /** Die ersten 16 Stellen des Hashs — genug zum Finden, nichts zum Erraten. */
    fun kennung(token: String): String = tokenHash(token).take(16)

    fun neueNonce(): String = hex(ByteArray(16).also { SecureRandom().nextBytes(it) })

    fun erwartet(token: String, nonce: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(tokenHash(token).toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return hex(mac.doFinal(nonce.toByteArray(Charsets.UTF_8)))
    }

    fun stimmt(token: String, nonce: String, beweis: String?): Boolean =
        beweis != null && MessageDigest.isEqual(
            erwartet(token, nonce).toByteArray(), beweis.lowercase().toByteArray())

    /** Den Beweis aus der Serverantwort lesen, ohne JSON-Bibliothek. */
    fun ausAntwort(json: String): String? =
        Regex("\"beweis\"\\s*:\\s*\"([0-9a-fA-F]{64})\"").find(json)?.groupValues?.get(1)
}

/**
 * Welche Server sich in welchem Netz schon ausgewiesen haben. Ein Netzwechsel
 * ergibt einen neuen Schlüssel und damit eine neue Prüfung.
 */
class BeweisSpeicher {
    private val geprueft = ConcurrentHashMap.newKeySet<String>()
    fun schluessel(host: String, port: Int, netz: String, token: String) =
        "$host:$port|$netz|${ServerBeweis.kennung(token)}"
    fun bekannt(schluessel: String) = schluessel in geprueft
    fun merke(schluessel: String) { geprueft += schluessel }
}
