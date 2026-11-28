package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * „Anzahl“ with minus and plus — one component for the set and part pages and the
 * set capture: the barcode dialog had a text field where the detail page had a
 * stepper, and the same quantity looked like two different things.
 * What a step writes is decided by the caller.
 */
@Composable
fun QuantityStepper(quantity: Int, onFewer: () -> Unit, onMore: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(vertical = Spacing.tiny),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.common_quantity),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.medium)) {
            WithTooltip(stringResource(R.string.cd_qty_decrease)) {
                QuantitiesButton(onClick = onFewer) {
                    Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease), Modifier.size(withFont(18.dp)))
                }
            }
            Text("$quantity", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.widthIn(min = 24.dp), textAlign = TextAlign.Center)
            WithTooltip(stringResource(R.string.cd_qty_increase)) {
                QuantitiesButton(onClick = onMore) {
                    Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase), Modifier.size(withFont(18.dp)))
                }
            }
        }
    }
}
