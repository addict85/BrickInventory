package ch.brickinventoryapp.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import ch.brickinventoryapp.security.DeviceLock
import ch.brickinventoryapp.security.VaultFinding
import ch.brickinventoryapp.security.readPatient
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest
import java.io.IOException

/** A detail in its forms: [secret] now, [old] under the pins' key, [clear] in plaintext. */
internal class Info(
    val secret: Preferences.Key<String>,
    val old: Preferences.Key<String>?,
    val clear: Preferences.Key<String>,
)

/**
 * Address, name and origin of the account under the details' key, read through their earlier
 * forms until the start takes them over. Apart from the token, which has a vault of its own:
 * these only work unlocked, and locked means "wait", never "no address".
 */
internal class TokenDetails(
    private val dataStore: DataStore<Preferences>,
    private val device: DevicesStore,
    private val pauseUntilUnlock: suspend (Long) -> Unit,
    private val lock: DeviceLock,
) {
    /** The raw values of a detail in all forms; if none changes, nothing has to be read anew. */
    fun raw(prefs: Preferences, a: Info): List<String?> = listOf(prefs[a.secret], a.old?.let { prefs[it] }, prefs[a.clear])

    /** An earlier form (under the pins' key or plaintext) until the start takes it over. */
    private fun earlier(raw: List<String?>, a: Info): String? =
        a.old?.let { k -> raw[1]?.let { device.decryptOldDetail(it, k.name) } } ?: raw[2]

    /** First the ciphertext, then an earlier form. Locked means wait, not „no address“. */
    fun open(raw: List<String?>, a: Info): VaultFinding {
        val b = raw[0]?.let { device.openDetail(it, a.secret.name) } ?: VaultFinding.Gone
        if (b != VaultFinding.Gone) return b
        return earlier(raw, a)?.let { VaultFinding.Readable(it) } ?: VaultFinding.Gone
    }

    /** Without waiting; locked is null here like „not there“. */
    fun value(prefs: Preferences, a: Info): String? = (open(raw(prefs, a), a) as? VaultFinding.Readable)?.plaintext

    /** Waits for unlocking with a locked device, like the token (readPatient). */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun flow(a: Info): Flow<String> = dataStore.data.map { raw(it, a) }.distinctUntilChanged()
        .transformLatest { r -> readPatient({ open(r, a) }, null, report = { emit(it) }, wait = pauseUntilUnlock, lock = lock) }

    fun encrypt(a: Info, value: String): String =
        device.encryptDetail(value, a.secret.name) ?: throw IOException("${a.secret.name} gerade nicht verschlüsselbar")

    /**
     * Earlier forms (plaintext or under the pins' key) under the details' key; if it fails
     * (locked), at the next start. The earlier form goes only when the new one is there.
     */
    fun adoptDetails(prefs: MutablePreferences, all: List<Info>) {
        for (a in all) {
            if (prefs[a.secret] == null) {
                val before = earlier(raw(prefs, a), a) ?: continue
                prefs[a.secret] = device.encryptDetail(before, a.secret.name) ?: continue
            }
            a.old?.let { prefs.remove(it) }
            prefs.remove(a.clear)
        }
    }
}

internal fun MutablePreferences.set(a: Info, secret: String) {
    this[a.secret] = secret
    a.old?.let { remove(it) }
    remove(a.clear)
}

internal fun MutablePreferences.remove(a: Info) {
    remove(a.secret)
    a.old?.let { remove(it) }
    remove(a.clear)
}
