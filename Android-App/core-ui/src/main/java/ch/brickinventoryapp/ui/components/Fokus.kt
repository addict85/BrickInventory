package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.border
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp

/**
 * Ein Rahmen in der Hauptfarbe, solange die Fläche den Tastatur- oder Schalterfokus
 * hat: Materials Zustandsebene lag nur 1,2:1 über der Fläche (WCAG 2.4.7). Steht vor
 * dem `clickable`, dessen Fokus es beobachtet; im Touch-Betrieb gibt es keinen Fokus.
 */
fun Modifier.fokusRahmen(form: Shape): Modifier = composed {
    var fokus by remember { mutableStateOf(false) }
    val farbe = MaterialTheme.colorScheme.primary
    onFocusChanged { fokus = it.hasFocus }
        .then(if (fokus) Modifier.border(FOKUS_RAHMEN, farbe, form) else Modifier)
}

/** Breite des Fokusrahmens: deutlich breiter als die 1-dp-Ränder der Karten. */
val FOKUS_RAHMEN = 3.dp
