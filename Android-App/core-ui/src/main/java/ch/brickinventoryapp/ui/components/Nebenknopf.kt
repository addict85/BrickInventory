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
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.gesperrtFarben

/**
 * Schrift des umrandeten Nebenknopfs in der Hauptfarbe. Die Material-Vorgabe setzt sie
 * in onSurfaceVariant, und im Dunkeln sah „Kopieren“ über einem gesperrten Knopf
 * selbst gesperrt aus.
 */
@Composable
fun nebenKnopfFarben(): ButtonColors = ButtonDefaults.outlinedButtonColors(
    contentColor = MaterialTheme.colorScheme.primary,
    disabledContentColor = gesperrtFarben(MaterialTheme.colorScheme).schrift,
)

/**
 * Rand des Nebenknopfs in outline (≥ 3:1 gegen jede Fläche) statt outlineVariant, das
 * kaum vom Grund abstach; gesperrt heller, aber mit 3:1 noch als Knopf erkennbar.
 */
@Composable
fun nebenKnopfRand(aktiv: Boolean = true): BorderStroke =
    BorderStroke(1.dp, if (aktiv) MaterialTheme.colorScheme.outline
                       else gesperrtFarben(MaterialTheme.colorScheme).rand)

/**
 * Gestapelte Knöpfe gleich breit, so breit wie der breiteste: „Set merken“ stand
 * schmaler über „Barcode scannen“, und die Gruppe wirkte unruhig. Jeder Knopf darin
 * nimmt `Modifier.fillMaxWidth()`.
 */
@Composable
fun KnopfStapel(inhalt: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.width(IntrinsicSize.Max), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein), content = inhalt)
}
