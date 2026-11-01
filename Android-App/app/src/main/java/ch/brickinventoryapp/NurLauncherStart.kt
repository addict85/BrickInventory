package ch.brickinventoryapp

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity

/**
 * Basis der exportierten MainActivity. Jede App kann sie starten, und der
 * NavHost liest aus dem Start-Intent Deep-Link-Ziele (deepLinkIds/-Args, data).
 * Deshalb verlieren Extras und Daten ihren Weg, bevor irgendetwas sie sieht:
 * übrig bleibt nur der Launcher-Start. Meldungen kommen über MeldungsEinstieg.
 */
abstract class NurLauncherStart : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        fremdeAngabenEntfernen(intent)
        super.onCreate(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        fremdeAngabenEntfernen(intent)
        super.onNewIntent(intent)
    }
}

internal fun fremdeAngabenEntfernen(intent: Intent?) {
    intent ?: return
    intent.replaceExtras(null as Bundle?)
    intent.data = null
    intent.clipData = null
}
