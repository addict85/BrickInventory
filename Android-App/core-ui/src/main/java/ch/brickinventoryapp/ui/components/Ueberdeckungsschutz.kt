package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider

/**
 * In einer sicherheitsrelevanten Bestätigung aufrufen: Das Dialogfenster verwirft
 * Berührungen, solange ein fremdes Fenster darüber liegt (Tapjacking). Am ganzen
 * Fenster und nicht am Knopf, weil eine Überlagerung sonst auf einen
 * Nachbarknopf zielen könnte; die App-Oberfläche bleibt ohne, damit
 * Bildschirmfilter dort nicht stören.
 */
@Composable
fun Ueberdeckungsschutz() {
    val view = LocalView.current
    DisposableEffect(view) {
        val fenster = (view.parent as? DialogWindowProvider)?.window
        (fenster?.decorView ?: view.rootView).filterTouchesWhenObscured = true
        onDispose { }
    }
}
