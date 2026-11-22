package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The large icon above an empty state, always on the same round surface:
 * with a surface sometimes and without one other times, the empty states looked like two patterns.
 *
 * Instead of an emoji: those look different depending on the manufacturer, carry their own colors
 * that no theme knows, and TalkBack reads out their name. Without a description,
 * because the text next to it carries the meaning.
 */
@Composable
fun EmptySymbol(image: ImageVector, size: Dp = 40.dp) {
    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer) {
        Box(Modifier.size(size * 2), contentAlignment = Alignment.Center) {
            Icon(image, contentDescription = null, modifier = Modifier.size(size))
        }
    }
}
