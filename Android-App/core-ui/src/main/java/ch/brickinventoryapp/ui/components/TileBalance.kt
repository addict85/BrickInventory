package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity

/**
 * Keeps a grid tile as tall as its neighbors when its name turns out shorter: [rows]
 * lines in bodyMedium, at the foot instead of as a gap below the name (minLines = 2 left
 * a blank line there).
 */
@Composable
fun TileBalance(rows: Int) {
    val height = with(LocalDensity.current) { MaterialTheme.typography.bodyMedium.lineHeight.toDp() }
    // Also a child of the column even without a missing line: with spacedBy every child costs the
    // spacing, and only the compensated tile would be taller by it.
    Spacer(Modifier.height(height * rows.coerceAtLeast(0)))
}
