package ch.brickinventoryapp.app

import android.content.Context
import android.provider.Settings
import androidx.core.content.edit
import ch.brickinventoryapp.ui.components.AppSperre

/**
 * Die App-Sperre je Gerät, synchron, weil schon das erste Bild nach dem Start davon
 * abhängt. Kein Konto steckt darin: Abmelden lässt sie stehen.
 */
internal class AppSperreAblage(kontext: Context) : AppSperre.Ablage {
    private val prefs = kontext.applicationContext.getSharedPreferences(DATEI, Context.MODE_PRIVATE)

    override fun minuten(): Int = prefs.getInt(MINUTEN, 0)
    override fun setzeMinuten(minuten: Int) = prefs.edit { putInt(MINUTEN, minuten) }
    override fun hintergrundSeit(): Long? = prefs.getLong(SEIT, -1L).takeIf { it >= 0 }
    override fun merkeHintergrund(seit: Long?) = prefs.edit { if (seit == null) remove(SEIT) else putLong(SEIT, seit) }
    override fun hintergrundStart(): Int? = prefs.getInt(START, -1).takeIf { it >= 0 }
    override fun merkeHintergrundStart(start: Int?) = prefs.edit { if (start == null) remove(START) else putInt(START, start) }
    override fun gesperrt(): Boolean = prefs.getBoolean(GESPERRT, false)
    // commit statt apply: Ein Prozessende gleich danach darf die Sperre nicht verlieren.
    override fun setzeGesperrt(an: Boolean) = prefs.edit(commit = true) { putBoolean(GESPERRT, an) }

    private companion object {
        const val DATEI = "app_sperre"
        const val MINUTEN = "minuten"
        const val SEIT = "hintergrund_seit"
        const val GESPERRT = "gesperrt"
        const val START = "hintergrund_geraetestart"
    }
}

/** Wie oft das Gerät gestartet wurde; null, wo das System den Zähler nicht liefert. */
internal fun geraeteStarts(kontext: Context): Int? =
    runCatching { Settings.Global.getInt(kontext.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()
