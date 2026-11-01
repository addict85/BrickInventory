package ch.brickinventoryapp.util

import android.content.ClipData
import android.os.PersistableBundle

/**
 * Ein Clip für Geheimnisse (Gutschein-Nummer und PIN, TOTP-Schlüssel,
 * Wiederherstellungscodes, Einladungscode). Ab Android 13 zeigt das System den
 * Inhalt dann nicht in der Kopier-Vorschau; Tastaturen schlagen ihn nicht vor.
 * Der Schlüssel als Text, weil ClipDescription.EXTRA_IS_SENSITIVE erst ab API 33
 * existiert und ältere Geräte ihn ebenso lesen dürfen.
 */
fun geheimerClip(etikett: String, text: String): ClipData =
    ClipData.newPlainText(etikett, text).apply {
        description.extras = PersistableBundle().apply { putBoolean(IST_GEHEIM, true) }
    }

/** Derselbe Wert wie ClipDescription.EXTRA_IS_SENSITIVE. */
const val IST_GEHEIM = "android.content.extra.IS_SENSITIVE"
