package ch.brickinventoryapp.app

import android.app.KeyguardManager
import android.content.Context
import android.provider.Settings
import androidx.core.content.edit
import ch.brickinventoryapp.ui.components.AppLock

/**
 * The app lock per device, synchronous because already the first frame after the start
 * depends on it. No account is in it: sign-out leaves it in place.
 */
internal class AppLockStore(context: Context) : AppLock.Ablage {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Set once on first read (AppLock.vorgabe) so that a later update changes nothing. */
    override fun minuten(): Int {
        if (!prefs.contains(MINUTES)) prefs.edit { putInt(MINUTES, AppLock.vorgabe(newInstalled(), secured())) }
        return prefs.getInt(MINUTES, 0)
    }

    // Equal times mean: never updated, so this installation is the first.
    private fun newInstalled(): Boolean = runCatching {
        app.packageManager.getPackageInfo(app.packageName, 0).let { it.firstInstallTime == it.lastUpdateTime }
    }.getOrDefault(false)

    private fun secured(): Boolean = app.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true

    override fun setMinutes(minuten: Int) = prefs.edit { putInt(MINUTES, minuten) }
    override fun backgroundSince(): Long? = prefs.getLong(SINCE, -1L).takeIf { it >= 0 }
    override fun rememberBackground(seit: Long?) = prefs.edit { if (seit == null) remove(SINCE) else putLong(SINCE, seit) }
    override fun backgroundStart(): Int? = prefs.getInt(START, -1).takeIf { it >= 0 }
    override fun rememberBackgroundStart(start: Int?) = prefs.edit { if (start == null) remove(START) else putInt(START, start) }
    override fun gesperrt(): Boolean = prefs.getBoolean(LOCKED, false)
    // commit instead of apply: a process end right afterwards must not lose the lock.
    override fun setLocked(an: Boolean) = prefs.edit(commit = true) { putBoolean(LOCKED, an) }

    private companion object {
        const val FILE = "app_sperre"
        const val MINUTES = "minuten"
        const val SINCE = "hintergrund_seit"
        const val LOCKED = "gesperrt"
        const val START = "hintergrund_geraetestart"
    }
}

/** How often the device was booted; null where the system does not provide the counter. */
internal fun devicesStarts(context: Context): Int? =
    runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()
