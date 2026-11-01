package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import ch.brickinventoryapp.ressourcen.R

/**
 * Berührungen verwerfen, solange ein fremdes Fenster darüber liegt (Tapjacking;
 * ab Android 12 blockiert das System selbst, betroffen sind 8 bis 11). In einem
 * Dialog gilt es für dessen Fenster, sonst für die Activity, solange der
 * Bildschirm steht — nur dort, wo ein untergeschobener Tipp schadet (Konto,
 * Haushalt, Bestätigungen). App-weit verlören Nutzer von Bildschirmfiltern auf
 * 8 bis 11 jede Bedienung. Gezählt wie beim Sichtschutz.
 */
@Composable
fun Ueberdeckungsschutz() {
    val view = LocalView.current
    DisposableEffect(view) {
        val ziel = (view.parent as? DialogWindowProvider)?.window?.decorView ?: view.rootView
        fun anzahl() = ziel.getTag(R.id.ueberdeckung_anzahl) as? Int ?: 0
        ziel.setTag(R.id.ueberdeckung_anzahl, anzahl() + 1)
        ziel.filterTouchesWhenObscured = true
        onDispose {
            val rest = anzahl() - 1
            ziel.setTag(R.id.ueberdeckung_anzahl, rest)
            if (rest <= 0) ziel.filterTouchesWhenObscured = false
        }
    }
}
