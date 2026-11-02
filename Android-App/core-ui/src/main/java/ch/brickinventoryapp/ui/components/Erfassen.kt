package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme

/**
 * Platz unter der letzten Zeile einer Liste mit Erfassen-Knopf: Knopfhöhe (56) und
 * sein Abstand zum Rand oben wie unten. Ohne ihn verdeckt der Knopf den letzten Eintrag.
 */
val FabPlatz = 56.dp + 16.dp * 2

/**
 * Der eine schwebende Knopf eines Bildschirms: Erfassen. Scannen sitzt als Symbol neben
 * der Suche (ScanKnopf) — zwei gestapelte Knöpfe verdeckten das Listenende, und welcher
 * der wichtigere ist, sagte nur ihre Grösse.
 */
@Composable
fun ErfassenFab(beschreibung: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val brick = LocalIsBrickTheme.current
    FloatingActionButton(
        onClick = onClick,
        modifier = modifier,
        containerColor = if (brick) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary,
        contentColor = if (brick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onPrimary,
        shape = Formen.fab,
    ) { Icon(Icons.Default.Add, beschreibung) }
}

/** Scannen als Symbolknopf neben einem Eingabefeld — mit Rand in `outline` (≥ 3:1). */
@Composable
fun ScanKnopf(onClick: () -> Unit, modifier: Modifier = Modifier, beschreibung: String = stringResource(R.string.gallery_scan_barcode)) {
    OutlinedIconButton(
        onClick = onClick,
        modifier = modifier,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = IconButtonDefaults.outlinedIconButtonColors(contentColor = MaterialTheme.colorScheme.primary),
    ) { Icon(BarcodeSymbol, beschreibung) }
}

/**
 * Strichcode im Scanrahmen. Material bietet nur einen QR-Scanner; gescannt werden hier
 * Strichcodes (EAN) der Schachteln, und das Symbol soll sagen, was die Kamera sucht.
 */
val BarcodeSymbol: ImageVector by lazy {
    ImageVector.Builder("Barcode", 24.dp, 24.dp, 24f, 24f).addPath(
        addPathNodes(
            "M2,4h4v1.5H3.5V8H2z M18,4h4v4h-1.5V5.5H18z M2,16h1.5v2.5H6V20H2z M20.5,16H22v4h-4v-1.5h2.5z" +
                " M6,7h1.5v10H6z M8.5,7h1v10h-1z M10.5,7h2v10h-2z M13.5,7h1v10h-1z M15.5,7h1v10h-1z M17,7h1v10h-1z"
        ),
        fill = SolidColor(Color.Black),
    ).build()
}
