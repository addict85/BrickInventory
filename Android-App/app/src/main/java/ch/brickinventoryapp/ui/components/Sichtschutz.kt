package ch.brickinventoryapp.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import ch.brickinventoryapp.R

/**
 * Kein Bildschirmfoto, keine Aufnahme und kein Vorschaubild in der App-Übersicht,
 * solange dieser Bildschirm steht — für Nummer und PIN der Gutscheine. Gezählt,
 * weil beim Übergang von der Gutscheinseite in ihr PDF beide kurz stehen und das
 * Ende der ersten den Schutz der zweiten sonst aufhöbe; der Zähler hängt am
 * Fenster, nicht an der Datei.
 */
@Composable
fun Sichtschutz() {
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity) {
        val fenster = activity.window
        fun anzahl() = fenster.decorView.getTag(R.id.sichtschutz_anzahl) as? Int ?: 0
        fun setze(n: Int) = fenster.decorView.setTag(R.id.sichtschutz_anzahl, n)
        if (anzahl() == 0) fenster.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        setze(anzahl() + 1)
        onDispose {
            setze(anzahl() - 1)
            if (anzahl() <= 0) fenster.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
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
