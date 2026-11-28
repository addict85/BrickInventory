package ch.brickinventoryapp.data

import androidx.datastore.preferences.core.Preferences
import ch.brickinventoryapp.security.VaultFinding
import java.io.IOException
import java.security.MessageDigest

/**
 * When the sign-in happened, sealed with a tag of the token under the details' key: a later
 * date or one copied from another sign-in fails the check, and a missing one counts as expired,
 * otherwise deleting it would restart the clock.
 */
internal class SignInExpiry(private val device: DevicesStore) {
    /** The date with a tag of the token; AES-GCM under the details' key, which only works unlocked. */
    fun seal(ms: Long, token: String): String =
        device.encryptDetail("$ms:${tokenTag(token)}", TokenStore.SIGNED_IN_SECRET.name)
            ?: throw IOException("${TokenStore.SIGNED_IN_SECRET.name} gerade nicht verschlüsselbar")

    /** Sealed date of [token]; otherwise a plaintext one of older versions until [TokenStore.LEGACY_DATE_UNTIL]. */
    fun read(prefs: Preferences, token: String, now: Long): LoginStatus {
        prefs[TokenStore.SIGNED_IN_SECRET]?.let { secret ->
            return when (val b = device.openDetail(secret, TokenStore.SIGNED_IN_SECRET.name)) {
                is VaultFinding.Readable -> b.plaintext.split(':').takeIf { it.size == 2 && it[1] == tokenTag(token) }
                    ?.get(0)?.toLongOrNull()?.let { LoginStatus.At(it, legacy = false) } ?: LoginStatus.Missing
                VaultFinding.LockedState -> LoginStatus.Locked
                VaultFinding.Gone -> LoginStatus.Missing
            }
        }
        // A date in the future would extend the sign-in; at most now counts.
        val old = prefs[TokenStore.SIGNED_IN_AT] ?: return LoginStatus.Missing
        return if (now < TokenStore.LEGACY_DATE_UNTIL) LoginStatus.At(minOf(old, now), legacy = true) else LoginStatus.Missing
    }
}

/** The sign-in date as found: readable and matching, not readable right now, or not to be trusted. */
internal sealed class LoginStatus {
    class At(val ms: Long, val legacy: Boolean) : LoginStatus()
    object Locked : LoginStatus()
    object Missing : LoginStatus()
}

/** 128 bits of the token's SHA-256: binds the date without the token itself lying in it. */
private fun tokenTag(token: String): String =
    MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)).take(16)
        .joinToString("") { "%02x".format(it) }
