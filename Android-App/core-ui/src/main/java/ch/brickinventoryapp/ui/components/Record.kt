package ch.brickinventoryapp.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.Shapes

/**
 * Space below the last row of a list with a capture button: button height (56) plus
 * its margin to the edge, top and bottom alike. Without it, the button covers the last entry.
 */
val FabSpace = 56.dp + 16.dp * 2

/**
 * How high the scaffold's snackbar currently stands above the content. The capture button
 * lives in the content, not the scaffold's FAB slot, and would otherwise not rise above it —
 * of all times during „undo“, when it would cover the main action.
 */
val LocalSnackbarSpace = compositionLocalOf { 0.dp }

/**
 * The one floating button of a screen: capture. Scanning sits as an icon next to
 * the search field (ScanButton) — two stacked buttons covered the end of the list, and which
 * one was more important was only said by their size.
 */
@Composable
fun AddFab(description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val brick = LocalIsBrickTheme.current
    val viaSnackbar by animateDpAsState(LocalSnackbarSpace.current, label = "fab-ueber-snackbar")
    FloatingActionButton(
        onClick = onClick,
        modifier = modifier.padding(bottom = viaSnackbar),
        containerColor = if (brick) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary,
        contentColor = if (brick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onPrimary,
        shape = Shapes.fab,
    ) { Icon(Icons.Default.Add, description) }
}

/** Scanning as an icon button next to an input field — with a border in `outline` (≥ 3:1). */
@Composable
fun ScanButton(onClick: () -> Unit, modifier: Modifier = Modifier, description: String = stringResource(R.string.gallery_scan_barcode)) {
    WithTooltip(description, modifier) {
        OutlinedIconButton(
            onClick = onClick,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            colors = IconButtonDefaults.outlinedIconButtonColors(contentColor = MaterialTheme.colorScheme.primary),
        ) { Icon(BarcodeSymbol, contentDescription = description) }
    }
}

/**
 * Barcode in the scan frame. Material only offers a QR scanner; what's scanned here are
 * barcodes (EAN) on boxes, and the icon should say what the camera is looking for.
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
