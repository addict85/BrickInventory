package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.lockedColors

/**
 * Text of the outlined secondary button in the primary color. Material's default sets it
 * in onSurfaceVariant, and in the dark theme, „Kopieren“ on a locked button
 * itself looked locked.
 */
@Composable
fun secondaryButtonColors(): ButtonColors = ButtonDefaults.outlinedButtonColors(
    contentColor = MaterialTheme.colorScheme.primary,
    disabledContentColor = lockedColors(MaterialTheme.colorScheme).font,
)

/**
 * Border of the secondary button in outline (≥ 3:1 against any surface) instead of outlineVariant, which
 * barely stood out from the background; locked lighter, but still recognizable as a button at 3:1.
 */
@Composable
fun secondaryButtonRand(active: Boolean = true): BorderStroke =
    BorderStroke(1.dp, if (active) MaterialTheme.colorScheme.outline
                       else lockedColors(MaterialTheme.colorScheme).edge)

/**
 * Stacked buttons equally wide, as wide as the widest one: "Remember set" stood
 * narrower above "Scan barcode", and the group looked uneven. Every button in it
 * takes `Modifier.fillMaxWidth()`.
 */
@Composable
fun ButtonStack(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.width(IntrinsicSize.Max), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.small), content = content)
}
