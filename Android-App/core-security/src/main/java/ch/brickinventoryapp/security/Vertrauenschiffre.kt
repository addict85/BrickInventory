package ch.brickinventoryapp.security

import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Two keys that survive sign-out. [schluessel] also works locked, because pins
 * and the user-CA switch decide on every TLS connection; an error there means „not trusted“.
 * [angaben] only works unlocked: address, name and orders reveal where the account lives.
 * Which is why there are three outcomes there ([openDetail]); without its own (tests) the first applies there too.
 */
class Vertrauenschiffre(
    angaben: (() -> ByteArray)? = null,
    schluessel: () -> ByteArray,
) {
    private val cipher = StoreCipher(schluessel)
    private val vertrauen = schluessel
    private val angaben: () -> ByteArray = angaben ?: schluessel

    fun verschluessle(wert: String, bindung: String): String? = runCatching {
        Base64.getEncoder().encodeToString(cipher.verschluessle(wert.toByteArray(Charsets.UTF_8), PURPOSE + bindung))
    }.getOrNull()

    fun entschluessle(gespeichert: String, bindung: String): String? = runCatching {
        cipher.entschluessle(Base64.getDecoder().decode(gespeichert), PURPOSE + bindung)?.toString(Charsets.UTF_8)
    }.getOrNull()

    /**
     * A name for an entry that reveals nothing about [bindung] (e.g. host and port of a
     * pin). HMAC under a dedicated, derived key; null if the Keystore can't do it.
     */
    fun name(bindung: String): String? = runCatching {
        val namensschluessel = hmac(vertrauen(), NAMEN)
        Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(namensschluessel, bindung)).take(NAME_LENGTH)
    }.getOrNull()

    /** null if the key isn't working right now (locked): then nothing is stored. */
    fun verschluessleDetail(wert: String, bindung: String): String? = runCatching {
        val k = angaben()
        Base64.getEncoder().encodeToString(StoreCipher { k }.verschluessle(wert.toByteArray(Charsets.UTF_8), ANGABE + bindung))
    }.getOrNull()

    /** Readable, gone (altered, bound to something else, different key), or locked (try again later). */
    fun openDetail(gespeichert: String, bindung: String): Tresorbefund {
        // The key outside the check: if it just can't work right now, the value isn't gone.
        val k = runCatching { angaben() }.getOrElse { return Tresorbefund.Gesperrt }
        val roh = runCatching { Base64.getDecoder().decode(gespeichert) }.getOrElse { return Tresorbefund.Weg }
        return StoreCipher { k }.entschluessle(roh, ANGABE + bindung)
            ?.let { Tresorbefund.Readable(it.toString(Charsets.UTF_8)) } ?: Tresorbefund.Weg
    }

    private companion object {
        const val PURPOSE = "vertrauen:"
        const val ANGABE = "angabe:"
        const val NAMEN = "namen"
        /** 22 Zeichen Base64url sind 132 Bit: genug, dass zwei Server nie denselben Namen bekommen. */
        const val NAME_LENGTH = 22

        fun hmac(schluessel: ByteArray, text: String): ByteArray = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(schluessel, "HmacSHA256"))
            doFinal(text.toByteArray(Charsets.UTF_8))
        }
    }
}
