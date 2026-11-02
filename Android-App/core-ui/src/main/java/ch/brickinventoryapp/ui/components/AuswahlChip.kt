package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp

/**
 * FilterChip, dessen Wahl man auch ohne Farbunterschied sieht: Häkchen vorn
 * (wenn der Aufrufer kein eigenes Symbol setzt) und ein Rand in primary. Die
 * Füllung allein lag in den dunklen Fassungen nur 1,2:1 über der Fläche.
 */
@Composable
fun AuswahlChip(
    selected: Boolean,
    onClick: () -> Unit,
    label: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = FilterChipDefaults.shape,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    enabled: Boolean = true,
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = label,
        modifier = modifier,
        enabled = enabled,
        shape = shape,
        leadingIcon = leadingIcon
            ?: if (selected) { { Icon(Icons.Default.Check, null, Modifier.size(FilterChipDefaults.IconSize)) } } else null,
        trailingIcon = trailingIcon,
        border = FilterChipDefaults.filterChipBorder(
            enabled = enabled, selected = selected,
            // outline statt outlineVariant: Der Rand eines ungewählten Chips ist seine einzige
            // Grenze und braucht 3:1 zur Fläche; outlineVariant lag bei 1,1–1,2:1.
            borderColor = MaterialTheme.colorScheme.outline,
            selectedBorderColor = MaterialTheme.colorScheme.primary, selectedBorderWidth = 1.dp,
        ),
    )
}
