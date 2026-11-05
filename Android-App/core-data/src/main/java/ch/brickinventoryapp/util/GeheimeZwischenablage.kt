package ch.brickinventoryapp.util

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock
import java.util.UUID

/**
 * Ein Clip für Geheimnisse (Gutschein-Nummer und PIN, TOTP-Schlüssel,
 * Wiederherstellungscodes, Einladungscode). Ab Android 13 zeigt das System den
 * Inhalt dann nicht in der Kopier-Vorschau; Tastaturen schlagen ihn nicht vor.
 * Der Schlüssel als Text, weil ClipDescription.EXTRA_IS_SENSITIVE erst ab API 33
 * existiert und ältere Geräte ihn ebenso lesen dürfen.
 */
fun geheimerClip(etikett: String, text: String, kennung: String? = null): ClipData =
    ClipData.newPlainText(etikett, text).apply {
        description.extras = PersistableBundle().apply {
            putBoolean(IST_GEHEIM, true)
            if (kennung != null) putString(GEHEIM_KENNUNG, kennung)
        }
    }

/** Derselbe Wert wie ClipDescription.EXTRA_IS_SENSITIVE. */
const val IST_GEHEIM = "android.content.extra.IS_SENSITIVE"
private const val GEHEIM_KENNUNG = "ch.brickinventoryapp.geheim_kennung"

/**
 * Kopiert ein Geheimnis und nimmt es nach [GEHEIM_ABLAUF_MS] wieder heraus, wenn
 * dort noch derselbe Clip liegt (geheimSchritt). Am Haupt-Looper statt im Scope
 * des Bildschirms: Der endet beim Verlassen der Seite, und das Geheimnis bliebe.
 */
object GeheimeZwischenablage {
    @Volatile private var kennung: String? = null
    @Volatile private var faelligAb = 0L

    fun kopiere(ctx: Context, etikett: String, text: String) {
        val app = ctx.applicationContext
        val neu = UUID.randomUUID().toString()
        app.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(geheimerClip(etikett, text, neu)) ?: return
        kennung = neu
        faelligAb = SystemClock.elapsedRealtime() + GEHEIM_ABLAUF_MS
        Handler(Looper.getMainLooper()).postDelayed({ pruefe(app) }, GEHEIM_ABLAUF_MS)
    }

    /** Auch beim Zurückkommen in die App (MainActivity): Im Hintergrund ist die Ablage nicht lesbar. */
    fun pruefe(ctx: Context) {
        val cm = ctx.applicationContext.getSystemService(ClipboardManager::class.java) ?: return
        val clip = runCatching { cm.primaryClip }.getOrNull()
        val lesbar = clip != null
        val imClip = clip?.description?.extras?.getString(GEHEIM_KENNUNG)
        when (geheimSchritt(kennung, faelligAb, SystemClock.elapsedRealtime(), lesbar, imClip)) {
            GeheimSchritt.WARTEN -> Unit
            GeheimSchritt.VERGESSEN -> kennung = null
            GeheimSchritt.LEEREN -> {
                cm.clearPrimaryClip()
                kennung = null
            }
        }
    }
}
