package ch.brickinventoryapp.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import ch.brickinventoryapp.ressourcen.R

/**
 * Kein Bildschirmfoto, keine Aufnahme und kein Vorschaubild in der App-Übersicht, solange
 * dieser Bildschirm steht — für Nummer und PIN der Gutscheine.
 * Ausführlich: docs/begruendungen/core-ui/ui/components/Sichtschutz.kt.md#sichtschutz
 */
@Composable
fun Sichtschutz(ueberdeckung: Boolean = true) {
    if (ueberdeckung) Ueberdeckungsschutz()
    val view = LocalView.current
    val activity = LocalContext.current.findActivity()
    DisposableEffect(view, activity) {
        // Ein Dialog hat ein eigenes Fenster und übernimmt FLAG_SECURE vom Fenster darunter
        // erst bei seinem nächsten Neuaufbau. Darum beide sofort, und beide gezählt.
        val fenster = listOfNotNull(activity?.window, (view.parent as? DialogWindowProvider)?.window).distinct()
        fenster.forEach(::sichere)
        onDispose { fenster.forEach(::gibFrei) }
    }
}

private fun anzahl(f: Window) = f.decorView.getTag(R.id.sichtschutz_anzahl) as? Int ?: 0

private fun sichere(f: Window) {
    if (anzahl(f) == 0) f.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    f.decorView.setTag(R.id.sichtschutz_anzahl, anzahl(f) + 1)
}

private fun gibFrei(f: Window) {
    val rest = anzahl(f) - 1
    f.decorView.setTag(R.id.sichtschutz_anzahl, rest)
    if (rest <= 0) f.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
}

private fun Context.findActivity(): Activity? {
    var c: Context = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}
