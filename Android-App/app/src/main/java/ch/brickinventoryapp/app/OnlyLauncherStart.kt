package ch.brickinventoryapp.app

import android.content.Intent
import android.os.Bundle
import androidx.fragment.app.FragmentActivity

/**
 * Base of the exported MainActivity. Any app can start it, and the
 * NavHost reads deep link targets from the start intent (deepLinkIds/-Args, data).
 * That is why extras and data lose their way before anything sees them:
 * only the launcher start remains. Notifications come via MessageEntryPoint.
 * FragmentActivity because BiometricPrompt (ui/components/Schrittschutz) needs one.
 */
abstract class OnlyLauncherStart : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        removeForeignDetails(intent)
        super.onCreate(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        removeForeignDetails(intent)
        super.onNewIntent(intent)
    }
}

internal fun removeForeignDetails(intent: Intent?) {
    intent ?: return
    intent.replaceExtras(null as Bundle?)
    intent.data = null
    intent.clipData = null
}
