package ch.brickinventoryapp.security

import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Two keys that survive sign-out. [key] also works locked, because pins
 * and the user-CA switch decide on every TLS connection; an error there means „not trusted“.
 * [info] only works unlocked: address, name and orders reveal where the account lives.
 * Which is why there are three outcomes there ([openDetail]); without its own (tests) the first applies there too.
 */
class TrustCipher(
    info: (() -> ByteArray)? = null,
    key: () -> ByteArray,
) {
    private val cipher = StoreCipher(key)
    private val trust = key
    private val info: () -> ByteArray = info ?: key

    fun encrypt(value: String, binding: String): String? = runCatching {
        Base64.getEncoder().encodeToString(cipher.encrypt(value.toByteArray(Charsets.UTF_8), PURPOSE + binding))
    }.getOrNull()

    fun decrypt(saved: String, binding: String): String? = runCatching {
        cipher.decrypt(Base64.getDecoder().decode(saved), PURPOSE + binding)?.toString(Charsets.UTF_8)
    }.getOrNull()

    /**
     * A name for an entry that reveals nothing about [binding] (e.g. host and port of a
     * pin). HMAC under a dedicated, derived key; null if the Keystore can't do it.
     */
    fun name(binding: String): String? = runCatching {
        val nameKey = hmac(trust(), NAMES)
        Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(nameKey, binding)).take(NAME_LENGTH)
    }.getOrNull()

    /** null if the key isn't working right now (locked): then nothing is stored. */
    fun encryptDetail(value: String, binding: String): String? = runCatching {
        val k = info()
        Base64.getEncoder().encodeToString(StoreCipher { k }.encrypt(value.toByteArray(Charsets.UTF_8), INFO + binding))
    }.getOrNull()

    /** Readable, gone (altered, bound to something else, different key), or locked (try again later). */
    fun openDetail(saved: String, binding: String): VaultFinding {
        // The key outside the check: if it just can't work right now, the value isn't gone.
        val k = runCatching { info() }.getOrElse { return VaultFinding.LockedState }
        val raw = runCatching { Base64.getDecoder().decode(saved) }.getOrElse { return VaultFinding.Gone }
        return StoreCipher { k }.decrypt(raw, INFO + binding)
            ?.let { VaultFinding.Readable(it.toString(Charsets.UTF_8)) } ?: VaultFinding.Gone
    }

    private companion object {
        const val PURPOSE = "vertrauen:"
        const val INFO = "angabe:"
        const val NAMES = "namen"
        /** 22 Zeichen Base64url sind 132 Bit: genug, dass zwei Server nie denselben Namen bekommen. */
        const val NAME_LENGTH = 22

        fun hmac(key: ByteArray, text: String): ByteArray = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(text.toByteArray(Charsets.UTF_8))
        }
    }
}
