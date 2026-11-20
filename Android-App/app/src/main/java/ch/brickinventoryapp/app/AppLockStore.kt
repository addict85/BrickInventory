package ch.brickinventoryapp.app

import android.app.KeyguardManager
import android.content.Context
import android.provider.Settings
import androidx.core.content.edit
import ch.brickinventoryapp.ui.components.AppLock

/**
 * Die App-Sperre je Gerät, synchron, weil schon das erste Bild nach dem Start davon
 * abhängt. Kein Konto steckt darin: Abmelden lässt sie stehen.
 */
internal class AppLockStore(context: Context) : AppLock.Ablage {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Beim ersten Lesen einmal festgelegt (AppLock.vorgabe), damit ein späteres Update nichts umstellt. */
    override fun minuten(): Int {
        if (!prefs.contains(MINUTES)) prefs.edit { putInt(MINUTES, AppLock.vorgabe(newInstalled(), secured())) }
        return prefs.getInt(MINUTES, 0)
    }

    // Gleiche Zeiten heissen: nie aktualisiert, also diese Installation ist die erste.
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
    // commit statt apply: Ein Prozessende gleich danach darf die Sperre nicht verlieren.
    override fun setLocked(an: Boolean) = prefs.edit(commit = true) { putBoolean(LOCKED, an) }

    private companion object {
        const val FILE = "app_sperre"
        const val MINUTES = "minuten"
        const val SINCE = "hintergrund_seit"
        const val LOCKED = "gesperrt"
        const val START = "hintergrund_geraetestart"
    }
}

/** Wie oft das Gerät gestartet wurde; null, wo das System den Zähler nicht liefert. */
internal fun devicesStarts(context: Context): Int? =
    runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()
