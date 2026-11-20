package ch.brickinventoryapp.ui.components

import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MotionEvent
import android.view.Window
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import ch.brickinventoryapp.resources.R

/**
 * Berührungen verwerfen, solange ein fremdes Fenster darüber liegt (Tapjacking; ab Android 12
 * blockiert das System selbst, betroffen ist Android 11).
 */
@Composable
fun Ueberdeckungsschutz() {
    val view = LocalView.current
    DisposableEffect(view) {
        val ownWindow = (view.parent as? DialogWindowProvider)?.window
        val ziel = ownWindow?.decorView ?: view.rootView
        val fenster = ownWindow ?: activityWindow(view.context)
        fun anzahl() = ziel.getTag(R.id.ueberdeckung_anzahl) as? Int ?: 0
        ziel.setTag(R.id.ueberdeckung_anzahl, anzahl() + 1)
        ziel.filterTouchesWhenObscured = true
        fenster?.let(PartialHiddenFilter::putAn)
        onDispose {
            val rest = anzahl() - 1
            ziel.setTag(R.id.ueberdeckung_anzahl, rest)
            if (rest <= 0) ziel.filterTouchesWhenObscured = false
            if (rest <= 0) fenster?.let(PartialHiddenFilter::entferne)
        }
    }
}

private fun activityWindow(context: android.content.Context): Window? =
    generateSequence(context) { (it as? android.content.ContextWrapper)?.baseContext }
        .filterIsInstance<android.app.Activity>().firstOrNull()?.window

/**
 * filterTouchesWhenObscured greift nur, wenn das fremde Fenster genau über dem
 * Tipp liegt. Liegt es daneben (FLAG_WINDOW_IS_PARTIALLY_OBSCURED),
 * kann es Text verdecken oder vortäuschen, während der Tipp durchgeht — darum
 * wird er hier vor dem ganzen Fenster verworfen. Ein laufender Zug endet mit
 * ACTION_CANCEL, damit kein Knopf gedrückt stehen bleibt.
 */
internal class PartialHiddenFilter(val alt: Window.Callback) : Window.Callback by alt {

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (!partialHidden(event)) return alt.dispatchTouchEvent(event)
        if (event.actionMasked != MotionEvent.ACTION_DOWN) {
            val abort = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
            alt.dispatchTouchEvent(abort)
            abort.recycle()
        }
        return true
    }

    // Standardmethoden der Schnittstelle reicht `by` nicht weiter.
    override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>?, menu: Menu?, deviceId: Int) =
        alt.onProvideKeyboardShortcuts(data, menu, deviceId)

    override fun onPointerCaptureChanged(hasCapture: Boolean) = alt.onPointerCaptureChanged(hasCapture)

    companion object {
        fun putAn(fenster: Window) {
            val jetzt = fenster.callback ?: return
            if (jetzt !is PartialHiddenFilter) fenster.callback = PartialHiddenFilter(jetzt)
        }

        fun entferne(fenster: Window) {
            (fenster.callback as? PartialHiddenFilter)?.let { fenster.callback = it.alt }
        }
    }
}

internal fun partialHidden(event: MotionEvent): Boolean =
    (event.flags and MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED) != 0
