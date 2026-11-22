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
 * A border in the primary color as long as the surface has
 * keyboard or switch focus: Material's state layer sat at only 1.2:1 against the surface (WCAG 2.4.7). Sits in front of
 * the `clickable` whose focus it observes; in touch mode there is no focus.
 */
fun Modifier.focusFrame(form: Shape): Modifier = composed {
    var fokus by remember { mutableStateOf(false) }
    val farbe = MaterialTheme.colorScheme.primary
    onFocusChanged { fokus = it.hasFocus }
        .then(if (fokus) Modifier.border(FOCUS_FRAME, farbe, form) else Modifier)
}

/** Width of the focus border: clearly wider than the cards' 1-dp borders. */
val FOCUS_FRAME = 3.dp
