package ch.brickinventoryapp.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.util.LocalSdkLevel

/**
 * Kein Bildschirmfoto, keine Aufnahme und kein Vorschaubild in der App-Übersicht, solange
 * dieser Bildschirm steht — für Nummer und PIN der Gutscheine.
 */
@Composable
fun Sichtschutz(coverage: Boolean = true) {
    if (coverage) Ueberdeckungsschutz()
    val view = LocalView.current
    val activity = LocalContext.current.findActivity()
    DisposableEffect(view, activity) {
        // Ein Dialog hat ein eigenes Fenster und übernimmt FLAG_SECURE vom Fenster darunter
        // erst bei seinem nächsten Neuaufbau. Darum beide sofort, und beide gezählt.
        val fenster = listOfNotNull(activity?.window, (view.parent as? DialogWindowProvider)?.window).distinct()
        fenster.forEach(::secure)
        onDispose { fenster.forEach(::giveFree) }
    }
}

/**
 * Mit eingeschalteter App-Sperre zeigt die App-Übersicht kein Vorschaubild: Es zeigte
 * sonst gerade das, was die Sperre verdecken soll, auch wenn „Vorschau verbergen“ aus ist.
 * Ab Android 13 nur das Vorschaubild, Bildschirmfotos bleiben erlaubt; darunter geht das
 * nur mit FLAG_SECURE über den Zähler von [Sichtschutz].
 */
@Composable
fun AppOverviewProtection(lock: AppLock) {
    val minuten by lock.minuten.collectAsState()
    if (minuten <= 0) return
    if (LocalSdkLevel.current < Build.VERSION_CODES.TIRAMISU) {
        Sichtschutz(coverage = false)
        return
    }
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) activity.setRecentsScreenshotEnabled(false)
        onDispose { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) activity.setRecentsScreenshotEnabled(true) }
    }
}

private fun protectedCount(f: Window) = f.decorView.getTag(R.id.sichtschutz_anzahl) as? Int ?: 0

private fun secure(f: Window) {
    if (protectedCount(f) == 0) f.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    f.decorView.setTag(R.id.sichtschutz_anzahl, protectedCount(f) + 1)
}

private fun giveFree(f: Window) {
    val rest = protectedCount(f) - 1
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
