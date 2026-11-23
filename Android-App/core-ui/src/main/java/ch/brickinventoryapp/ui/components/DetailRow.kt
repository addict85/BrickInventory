package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Spacing

/** A row of the detail cards (catalog, wishlist), limited to reading width on the tablet at most. */
@Composable
fun CatalogDetailRow(label: String, value: String) {
    LabelAndValue(label, value, Modifier.widthIn(max = ReadingWidth.valueRow))
}

/**
 * Label on the left, value on the right — and stacked with large text. The value
 * never wraps: nobody read „CHF 1,712.40“ digit by digit across three lines;
 * the label may span several lines, it takes whatever space is left.
 */
@Composable
fun LabelAndValue(
    name: String,
    value: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    valueStyle: TextStyle = style,
    labelColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    valueWeight: FontWeight = FontWeight.SemiBold,
) {
    if (largeFont()) {
        Column(modifier.fillMaxWidth()) {
            Text(name, color = labelColor, style = style)
            Text(value, fontWeight = valueWeight, style = valueStyle, color = MaterialTheme.colorScheme.onSurface)
        }
    } else {
        Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(name, color = labelColor, style = style, modifier = Modifier.weight(1f))
            Text(value, fontWeight = valueWeight, style = valueStyle, color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1, softWrap = false, modifier = Modifier.padding(start = Spacing.large))
        }
    }
}
