package ch.brickinventoryapp.app

import android.content.Context
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
    override fun gesperrt(): Boolean = prefs.getBoolean(GESPERRT, false)
    // commit statt apply: Ein Prozessende gleich danach darf die Sperre nicht verlieren.
    override fun setzeGesperrt(an: Boolean) = prefs.edit(commit = true) { putBoolean(GESPERRT, an) }

    private companion object {
        const val DATEI = "app_sperre"
        const val MINUTEN = "minuten"
        const val SEIT = "hintergrund_seit"
        const val GESPERRT = "gesperrt"
    }
}
