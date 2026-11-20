package ch.brickinventoryapp.ui.util

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
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
internal fun secretClip(etikett: String, text: String, kennung: String? = null): ClipData =
    ClipData.newPlainText(etikett, text).apply {
        description.extras = PersistableBundle().apply {
            putBoolean(IS_SECRET, true)
            if (kennung != null) putString(SECRET_ID, kennung)
        }
    }

/**
 * Erst ab Android 13 hält das System einen als geheim markierten Clip aus Kopier-Vorschau
 * und Tastaturverlauf heraus. Darunter steht er dort im Klartext: Kopieren gibt es dann
 * nur, wo es keinen anderen Weg gibt, und mit Warnung ([SecretKopierWarning]).
 */
fun secretCopyable(sdk: Int): Boolean = sdk >= Build.VERSION_CODES.TIRAMISU

/** Derselbe Wert wie ClipDescription.EXTRA_IS_SENSITIVE. */
internal const val IS_SECRET = "android.content.extra.IS_SENSITIVE"
private const val SECRET_ID = "ch.brickinventoryapp.geheim_kennung"

/**
 * Kopiert ein Geheimnis und nimmt es nach [SECRET_FLOW_MS] wieder heraus, wenn
 * dort noch derselbe Clip liegt (secretStep). Am Haupt-Looper statt im Scope
 * des Bildschirms: Der endet beim Verlassen der Seite, und das Geheimnis bliebe.
 */
object SecretClipboard {
    @Volatile private var kennung: String? = null
    @Volatile private var dueAb = 0L

    fun copy(ctx: Context, etikett: String, text: String) {
        val app = ctx.applicationContext
        val neu = UUID.randomUUID().toString()
        app.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(secretClip(etikett, text, neu)) ?: return
        kennung = neu
        dueAb = SystemClock.elapsedRealtime() + SECRET_FLOW_MS
        Handler(Looper.getMainLooper()).postDelayed({ pruefe(app) }, SECRET_FLOW_MS)
    }

    /** Auch beim Zurückkommen in die App (MainActivity): Im Hintergrund ist die Ablage nicht lesbar. */
    fun pruefe(ctx: Context) {
        val cm = ctx.applicationContext.getSystemService(ClipboardManager::class.java) ?: return
        val clip = runCatching { cm.primaryClip }.getOrNull()
        val lesbar = clip != null
        val inClip = clip?.description?.extras?.getString(SECRET_ID)
        when (secretStep(kennung, dueAb, SystemClock.elapsedRealtime(), lesbar, inClip)) {
            SecretStep.WARTEN -> Unit
            SecretStep.FORGOTTEN -> kennung = null
            SecretStep.LEEREN -> {
                cm.clearPrimaryClip()
                kennung = null
            }
        }
    }
}
