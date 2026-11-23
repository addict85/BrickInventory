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
 * A FilterChip whose selection you can see even without a color difference: a checkmark in front
 * (unless the caller sets its own icon) and a border in primary. The
 * fill alone sat at only 1.2:1 against the surface in the dark themes.
 */
@Composable
fun SelectionChip(
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
            // outline instead of outlineVariant: the border of an unselected chip is its only
            // boundary and needs 3:1 against the surface; outlineVariant sat at 1.1–1.2:1.
            borderColor = MaterialTheme.colorScheme.outline,
            selectedBorderColor = MaterialTheme.colorScheme.primary, selectedBorderWidth = 1.dp,
        ),
    )
}
