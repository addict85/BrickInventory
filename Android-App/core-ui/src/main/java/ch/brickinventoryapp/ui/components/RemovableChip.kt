package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * An entry of a collected list that a tap removes. The cross says what it removes
 * ([removeLabel]), so TalkBack announces the action, not only the number; the caller offers
 * „Undo“, because a tap while scrolling is quickly made.
 */
@Composable
fun RemovableChip(label: String, removeLabel: String, onRemove: () -> Unit, modifier: Modifier = Modifier) {
    InputChip(
        selected = false,
        onClick = onRemove,
        label = { Text(label, style = MaterialTheme.typography.bodySmall) },
        modifier = modifier,
        trailingIcon = { Icon(Icons.Default.Close, removeLabel, Modifier.size(withFont(InputChipDefaults.IconSize))) },
        // outline, not outlineVariant: the border is the chip's only boundary and needs 3:1.
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    )
}
