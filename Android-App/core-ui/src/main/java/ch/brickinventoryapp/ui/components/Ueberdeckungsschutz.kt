package ch.brickinventoryapp.ui.components

import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MotionEvent
import android.view.Window
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import ch.brickinventoryapp.ressourcen.R

/**
 * Berührungen verwerfen, solange ein fremdes Fenster darüber liegt (Tapjacking; ab Android 12
 * blockiert das System selbst, betroffen ist Android 11).
 * Ausführlich: docs/begruendungen/core-ui/ui/components/Ueberdeckungsschutz.kt.md#ueberdeckungsschutz
 */
@Composable
fun Ueberdeckungsschutz() {
    val view = LocalView.current
    DisposableEffect(view) {
        val dialog = (view.parent as? DialogWindowProvider)?.window
        val ziel = dialog?.decorView ?: view.rootView
        val fenster = dialog ?: activityFenster(view.context)
        fun anzahl() = ziel.getTag(R.id.ueberdeckung_anzahl) as? Int ?: 0
        ziel.setTag(R.id.ueberdeckung_anzahl, anzahl() + 1)
        ziel.filterTouchesWhenObscured = true
        fenster?.let(TeilweiseVerdecktFilter::legeAn)
        onDispose {
            val rest = anzahl() - 1
            ziel.setTag(R.id.ueberdeckung_anzahl, rest)
            if (rest <= 0) ziel.filterTouchesWhenObscured = false
            if (rest <= 0) fenster?.let(TeilweiseVerdecktFilter::entferne)
        }
    }
}

private fun activityFenster(context: android.content.Context): Window? =
    generateSequence(context) { (it as? android.content.ContextWrapper)?.baseContext }
        .filterIsInstance<android.app.Activity>().firstOrNull()?.window

/**
 * filterTouchesWhenObscured greift nur, wenn das fremde Fenster genau über dem
 * Tipp liegt. Liegt es daneben (FLAG_WINDOW_IS_PARTIALLY_OBSCURED),
 * kann es Text verdecken oder vortäuschen, während der Tipp durchgeht — darum
 * wird er hier vor dem ganzen Fenster verworfen. Ein laufender Zug endet mit
 * ACTION_CANCEL, damit kein Knopf gedrückt stehen bleibt.
 */
internal class TeilweiseVerdecktFilter(val alt: Window.Callback) : Window.Callback by alt {

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (!teilweiseVerdeckt(event)) return alt.dispatchTouchEvent(event)
        if (event.actionMasked != MotionEvent.ACTION_DOWN) {
            val abbruch = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
            alt.dispatchTouchEvent(abbruch)
            abbruch.recycle()
        }
        return true
    }

    // Standardmethoden der Schnittstelle reicht `by` nicht weiter.
    override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>?, menu: Menu?, deviceId: Int) =
        alt.onProvideKeyboardShortcuts(data, menu, deviceId)

    override fun onPointerCaptureChanged(hasCapture: Boolean) = alt.onPointerCaptureChanged(hasCapture)

    companion object {
        fun legeAn(fenster: Window) {
            val jetzt = fenster.callback ?: return
            if (jetzt !is TeilweiseVerdecktFilter) fenster.callback = TeilweiseVerdecktFilter(jetzt)
        }

        fun entferne(fenster: Window) {
            (fenster.callback as? TeilweiseVerdecktFilter)?.let { fenster.callback = it.alt }
        }
    }
}

internal fun teilweiseVerdeckt(event: MotionEvent): Boolean =
    (event.flags and MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED) != 0
