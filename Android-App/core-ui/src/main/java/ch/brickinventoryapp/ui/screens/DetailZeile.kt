package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.theme.Abstaende

@Composable
fun CatalogDetailRow(label: String, value: String) {
    BezeichnungUndWert(label, value)
}

/**
 * Bezeichnung links, Wert rechts — und bei grosser Schrift untereinander. Der Wert
 * bricht nie um: „CHF 1,712.40“ Ziffer für Ziffer über drei Zeilen las niemand;
 * die Bezeichnung darf mehrzeilig werden, sie nimmt sich den übrigen Platz.
 */
@Composable
fun BezeichnungUndWert(
    bezeichnung: String,
    wert: String,
    modifier: Modifier = Modifier,
    stil: TextStyle = MaterialTheme.typography.bodyMedium,
    wertStil: TextStyle = stil,
    bezeichnungFarbe: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    wertGewicht: FontWeight = FontWeight.SemiBold,
) {
    if (grosseSchrift()) {
        Column(modifier.fillMaxWidth()) {
            Text(bezeichnung, color = bezeichnungFarbe, style = stil)
            Text(wert, fontWeight = wertGewicht, style = wertStil, color = MaterialTheme.colorScheme.onSurface)
        }
    } else {
        Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(bezeichnung, color = bezeichnungFarbe, style = stil, modifier = Modifier.weight(1f))
            Text(wert, fontWeight = wertGewicht, style = wertStil, color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1, softWrap = false, modifier = Modifier.padding(start = Abstaende.gross))
        }
    }
}
