package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite

/** A row of the detail cards (catalog, wishlist), limited to reading width on the tablet at most. */
@Composable
fun CatalogDetailRow(label: String, value: String) {
    LabelAndValue(label, value, Modifier.widthIn(max = Lesebreite.wertzeile))
}

/**
 * Label on the left, value on the right — and stacked with large text. The value
 * never wraps: nobody read „CHF 1,712.40“ digit by digit across three lines;
 * the label may span several lines, it takes whatever space is left.
 */
@Composable
fun LabelAndValue(
    bezeichnung: String,
    wert: String,
    modifier: Modifier = Modifier,
    stil: TextStyle = MaterialTheme.typography.bodyMedium,
    valueStyle: TextStyle = stil,
    labelColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    valueWeight: FontWeight = FontWeight.SemiBold,
) {
    if (largeFont()) {
        Column(modifier.fillMaxWidth()) {
            Text(bezeichnung, color = labelColor, style = stil)
            Text(wert, fontWeight = valueWeight, style = valueStyle, color = MaterialTheme.colorScheme.onSurface)
        }
    } else {
        Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(bezeichnung, color = labelColor, style = stil, modifier = Modifier.weight(1f))
            Text(wert, fontWeight = valueWeight, style = valueStyle, color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1, softWrap = false, modifier = Modifier.padding(start = Abstaende.gross))
        }
    }
}
