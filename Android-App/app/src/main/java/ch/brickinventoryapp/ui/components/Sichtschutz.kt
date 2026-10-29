package ch.brickinventoryapp.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext

/** Wie viele Bildschirme gerade Sichtschutz wollen; nur der Hauptthread zählt. */
private var sichtschutzAnzahl = 0

/**
 * Kein Bildschirmfoto, keine Aufnahme und kein Vorschaubild in der App-Übersicht,
 * solange dieser Bildschirm steht — für Nummer und PIN der Gutscheine. Gezählt,
 * weil beim Übergang von der Gutscheinseite in ihr PDF beide kurz stehen und das
 * Ende der ersten den Schutz der zweiten sonst aufhöbe.
 */
@Composable
fun Sichtschutz() {
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity) {
        if (sichtschutzAnzahl++ == 0) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose {
            if (--sichtschutzAnzahl == 0) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}

private fun Context.findActivity(): Activity? {
    var c: Context = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}
