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
 * A clip for secrets (voucher number and PIN, TOTP key,
 * recovery codes, invite code). From Android 13 the system then doesn't show the
 * content in the copy preview; keyboards don't suggest it.
 * The key as text, because ClipDescription.EXTRA_IS_SENSITIVE only exists
 * from API 33, and older devices may read it the same way regardless.
 */
internal fun secretClip(etikett: String, text: String, kennung: String? = null): ClipData =
    ClipData.newPlainText(etikett, text).apply {
        description.extras = PersistableBundle().apply {
            putBoolean(IS_SECRET, true)
            if (kennung != null) putString(SECRET_ID, kennung)
        }
    }

/**
 * Only from Android 13 does the system keep a clip marked sensitive out of the copy
 * preview and keyboard history. Below that it sits there in plain text: copying then
 * only exists where there is no other way, and with a warning ([SecretKopierWarning]).
 */
fun secretCopyable(sdk: Int): Boolean = sdk >= Build.VERSION_CODES.TIRAMISU

/** The same value as ClipDescription.EXTRA_IS_SENSITIVE. */
internal const val IS_SECRET = "android.content.extra.IS_SENSITIVE"
private const val SECRET_ID = "ch.brickinventoryapp.geheim_kennung"

/**
 * Copies a secret and takes it back out after [SECRET_FLOW_MS] if
 * the same clip is still there (secretStep). On the main looper instead of the
 * screen's scope: that ends when leaving the page, and the secret would remain.
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

    /** Also on returning to the app (MainActivity): the clipboard is not readable in the background. */
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
