package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity

/**
 * Hält eine Rasterkachel so hoch wie ihre Nachbarn, wenn ihr Name kürzer ausfiel: [zeilen]
 * Zeilen in bodyMedium, am Fuss statt als Lücke unter dem Namen (minLines = 2 liess dort
 * eine Leerzeile stehen).
 */
@Composable
fun KachelAusgleich(zeilen: Int) {
    if (zeilen <= 0) return
    val hoehe = with(LocalDensity.current) { MaterialTheme.typography.bodyMedium.lineHeight.toDp() }
    Spacer(Modifier.height(hoehe * zeilen))
}
