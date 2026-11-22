package ch.brickinventoryapp.app

import android.app.KeyguardManager
import android.content.Context
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.core.content.edit
import ch.brickinventoryapp.ui.components.AppLock
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey

/**
 * The app lock per device, synchronous because already the first frame after the start
 * depends on it. No account is in it: sign-out leaves it in place.
 *
 * The values are sealed with a Keystore HMAC ([seal]): whoever edits the file (backup
 * restore, root) to „unlocked“ or „0 minutes“ breaks the seal, and a broken seal locks
 * (fail closed). Only the signature of the app lock's key opens it again (AppUnlocking).
 */
internal class AppLockStore(context: Context, private val seal: LockSeal = KeystoreLockSeal) : AppLock.Ablage {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Checked once per instance; the file does not change under a running process. */
    private var checked = false

    private fun checkSeal() {
        if (checked) return
        checked = true
        val stored = prefs.getString(SEAL, null)
        // Never sealed on this device (fresh install or update): take over once, as before.
        if (stored == null && !seal.exists()) return reseal()
        val expected = sealOf()
        if (expected != null && stored != null && MessageDigest.isEqual(expected.toByteArray(), stored.toByteArray())) return
        // Tampered: locked, and a lock that was switched off comes back with the default.
        val minutes = prefs.getInt(MINUTES, 0)
        prefs.edit(commit = true) {
            putBoolean(LOCKED, true)
            if (minutes == 0 && secured()) putInt(MINUTES, AppLock.DEFAULT_MINUTES)
        }
        reseal()
    }

    private fun state(): String = listOf(
        prefs.getInt(MINUTES, -1), prefs.getLong(SINCE, -1L), prefs.getInt(START, -1), prefs.getBoolean(LOCKED, false),
    ).joinToString("|", prefix = "v1|")

    private fun sealOf(): String? = seal.mac(state().toByteArray(Charsets.UTF_8))?.let { Base64.getEncoder().encodeToString(it) }

    // Without a usable key no seal: the next start then counts the state as tampered and locks.
    private fun reseal() = prefs.edit(commit = true) {
        val neu = sealOf()
        if (neu == null) remove(SEAL) else putString(SEAL, neu)
    }

    private fun write(change: android.content.SharedPreferences.Editor.() -> Unit) {
        checkSeal()
        prefs.edit(commit = true, action = change)
        reseal()
    }

    /** Set once on first read (AppLock.vorgabe) so that a later update changes nothing. */
    override fun minuten(): Int {
        checkSeal()
        if (!prefs.contains(MINUTES)) write { putInt(MINUTES, AppLock.vorgabe(newInstalled(), secured())) }
        return prefs.getInt(MINUTES, 0)
    }

    // Equal times mean: never updated, so this installation is the first.
    private fun newInstalled(): Boolean = runCatching {
        app.packageManager.getPackageInfo(app.packageName, 0).let { it.firstInstallTime == it.lastUpdateTime }
    }.getOrDefault(false)

    private fun secured(): Boolean = app.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true

    override fun setMinutes(minuten: Int) = write { putInt(MINUTES, minuten) }
    override fun backgroundSince(): Long? { checkSeal(); return prefs.getLong(SINCE, -1L).takeIf { it >= 0 } }
    override fun rememberBackground(seit: Long?) = write { if (seit == null) remove(SINCE) else putLong(SINCE, seit) }
    override fun backgroundStart(): Int? { checkSeal(); return prefs.getInt(START, -1).takeIf { it >= 0 } }
    override fun rememberBackgroundStart(start: Int?) = write { if (start == null) remove(START) else putInt(START, start) }
    override fun gesperrt(): Boolean { checkSeal(); return prefs.getBoolean(LOCKED, false) }
    // commit instead of apply: a process end right afterwards must not lose the lock.
    override fun setLocked(an: Boolean) = write { putBoolean(LOCKED, an) }

    private companion object {
        const val FILE = "app_sperre"
        const val MINUTES = "minuten"
        const val SINCE = "hintergrund_seit"
        const val LOCKED = "gesperrt"
        const val START = "hintergrund_geraetestart"
        const val SEAL = "siegel"
    }
}

/** The HMAC over the lock state; on the device in the Keystore, in the test in software. */
internal interface LockSeal {
    /** null if the key cannot work right now. */
    fun mac(data: ByteArray): ByteArray?

    /** Was a seal key ever created here? Without one the state of an older version is taken over. */
    fun exists(): Boolean
}

/**
 * Without user authentication: onStop writes the background time without asking anyone.
 * The key never leaves the Keystore, so a copied or edited file cannot be sealed anew.
 */
internal object KeystoreLockSeal : LockSeal {
    private const val ALIAS = "app_sperre_siegel"
    private const val KEYSTORE = "AndroidKeyStore"

    private fun keystore() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    override fun exists(): Boolean = runCatching { keystore().containsAlias(ALIAS) }.getOrDefault(true)

    override fun mac(data: ByteArray): ByteArray? = runCatching {
        val key = keystore().getKey(ALIAS, null) as? SecretKey ?: create()
        Mac.getInstance("HmacSHA256").run { init(key); doFinal(data) }
    }.getOrNull()

    private fun create(): SecretKey = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, KEYSTORE).run {
        init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN).build())
        generateKey()
    }
}

/** How often the device was booted; null where the system does not provide the counter. */
internal fun devicesStarts(context: Context): Int? =
    runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()
