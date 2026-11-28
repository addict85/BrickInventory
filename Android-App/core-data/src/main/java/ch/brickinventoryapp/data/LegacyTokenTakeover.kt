package ch.brickinventoryapp.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.VaultFinding
import kotlinx.coroutines.flow.first

/**
 * What older versions left behind: a plaintext token (only removed, never taken over: it may
 * have been copied) and a ciphertext under the weaker key of earlier versions (rekeyed). Apart
 * from the token's daily path, because it only runs at start and after unlocking.
 */
internal class LegacyTokenTakeover(
    private val dataStore: DataStore<Preferences>,
    private val vault: TokenEncryption,
) {
    /** @return true if a plaintext token was removed. */
    suspend fun adoptOldToken(): Boolean {
        var removed = false
        var rekeyed = false
        dataStore.edit { prefs ->
            removed = !prefs[TokenStore.AUTH_TOKEN].isNullOrEmpty()
            prefs.remove(TokenStore.AUTH_TOKEN)
            rekeyed = rekey(prefs)
        }
        if (rekeyed) catchUnlessCancelled { vault.forgetLegacyStock() }
        return removed
    }

    /**
     * A token of earlier versions under the weaker key would stay readable until the next start
     * for anyone who reads out the locked device; hence right after unlocking. Without legacy stock no writing.
     */
    suspend fun levelTokenHigh() {
        if (dataStore.data.first()[TokenStore.AUTH_TOKEN_ENC]?.let(vault::stale) != true) return
        var rekeyed = false
        dataStore.edit { rekeyed = rekey(it) }
        if (rekeyed) catchUnlessCancelled { vault.forgetLegacyStock() }
    }

    /**
     * A ciphertext under the weaker key of earlier versions goes under the one that
     * only works unlocked. In the same edit as the reading: a swap in between would otherwise
     * be overwritten by the old token. The caller deletes the old key only after
     * writing: if the edit fails, a ciphertext without a key would otherwise remain.
     */
    private fun rekey(prefs: MutablePreferences): Boolean {
        val secret = prefs[TokenStore.AUTH_TOKEN_ENC]?.takeIf(vault::stale) ?: return false
        val clear = (vault.open(secret) as? VaultFinding.Readable)?.plaintext ?: return false
        val newValue = catchUnlessCancelled { vault.encrypt(clear) }.getOrNull() ?: return false
        if (vault.stale(newValue)) return false
        prefs[TokenStore.AUTH_TOKEN_ENC] = newValue
        return true
    }
}
