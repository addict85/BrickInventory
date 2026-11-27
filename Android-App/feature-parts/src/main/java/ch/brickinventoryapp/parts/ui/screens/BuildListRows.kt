package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.catalogName
import ch.brickinventoryapp.ui.components.colorTranslator
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.colorFromHex
import ch.brickinventoryapp.ui.theme.windowSurface
import ch.brickinventoryapp.ui.util.fmtInt
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade

/** PDF of the finished list; an error comes as a dialog. The export runs in the ViewModel. */
@Composable
internal fun PdfButton(exportRunning: Boolean, pdfError: String?, onExport: () -> Unit, onErrorSeen: () -> Unit) {
    if (pdfError != null) {
        val title = stringResource(R.string.partslist_pdf_error_title)
        androidx.compose.material3.AlertDialog(
            containerColor = windowSurface(),
            onDismissRequest = onErrorSeen,
            modifier = Modifier.semantics { paneTitle = title },
            confirmButton = { TextButton(onClick = onErrorSeen) { Text(stringResource(R.string.common_ok)) } },
            title = { Text(title, Modifier.semantics { heading() }) },
            text = { Text(pdfError) }
        )
    }
    // Outlined like every secondary action: the tinted surface was barely visible above the background in the light theme.
    OutlinedButton(
        onClick = onExport,
        enabled = !exportRunning,
        colors = secondaryButtonColors(),
        border = secondaryButtonRand(!exportRunning),
    ) {
        // Only the icon turns into a spinner, the label stays (as above).
        if (exportRunning) CircularProgressIndicator(Modifier.size(16.dp),
            strokeWidth = 2.dp)
        else Icon(Icons.Default.PictureAsPdf, null, Modifier.size(withFont(16.dp)))
        Spacer(Modifier.width(Spacing.tiny))
        Text(stringResource(R.string.common_pdf))
    }
}

/** Header of a color group: color dot, name and how many parts and types it has; [colorName] null = minifigures. */
@Composable
internal fun ColorGroupsHeader(colorName: String?, colorParts: List<PlPart>) {
    val quantities = androidx.compose.ui.platform.LocalResources.current
    val color = colorTranslator()
    Row(verticalAlignment = Alignment.CenterVertically) {
        val hex = colorParts.first().colorHex
        if (hex != null && !colorParts.first().isFig) {
            Box(Modifier.size(14.dp).clip(CircleShape)
                .background(colorFromHex(hex) ?: Color.Gray))
            Spacer(Modifier.width(6.dp))
        }
        val displayName = when {
            colorName == null -> stringResource(R.string.detail_minifigs)
            colorName.isEmpty() -> stringResource(R.string.partslist_no_color)
            else -> color(colorName)
        }
        Text(displayName, fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(Spacing.small))
        // Agreement with %2$d (the types) — %1$d carries
        // only an "×" and no word.
        Text(quantities.getQuantityString(R.plurals.partslist_group_summary,
                colorParts.size, colorParts.sumOf { it.quantity }, colorParts.size),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider(Modifier.padding(top = Spacing.tiny), color = MaterialTheme.colorScheme.primaryContainer)
}

@Composable
internal fun PartListRow(
    part: PlPart,
    serverUrl: String,
    imageLoader: ImageLoader,
) {
    val ctx = LocalContext.current
    // part.imageUrl is already resolved (ui/PartList.kt); a second
    // resolveThumbUrl() would wrap the proxy address a second time. Only a relative path
    // gets the server prepended.
    val imgUrl = remember(part.imageUrl, serverUrl) {
        part.imageUrl?.let { url ->
            if (url.startsWith("/")) "$serverUrl$url" else url
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(vertical = Spacing.tiny),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Image
        ProductImage(
            model = imgUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
            imageLoader = imageLoader,
            contentDescription = part.partName,
            modifier = Modifier.size(48.dp).clip(MaterialTheme.shapes.small),
            contentScale = ContentScale.Fit,
            fallbackSize = 24.dp,
        )
        // Info
        Column(Modifier.weight(1f)) {
            // BL-ID (primary) and RB-ID (secondary)
            val displayId = part.blPartNumber ?: part.partNumber
            // Not tappable on its own, hence not in the color of links (as on the set tile).
            Text(displayId, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
            if (part.blPartNumber != null && part.blPartNumber != part.partNumber) {
                Text(stringResource(R.string.partslist_rb_prefix, part.partNumber), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(catalogName(part.partName), style = MaterialTheme.typography.bodySmall,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
            QuantitiesPills(part)
        }
    }
}

/**
 * What the list needs and what is in stock, spelled out instead of "×12" and "✓ 8":
 * without a legend nobody could read which number was which. Below the name instead of next to it,
 * so that at large font the name does not shrink to one word per line.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuantitiesPills(part: PlPart) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.tiny),
        verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
        Pill(stringResource(R.string.partslist_needed, fmtInt(part.quantity)),
            if (part.isFig) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.primaryContainer,
            if (part.isFig) MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onPrimaryContainer)
        // Green if it is enough, otherwise red with the shortfall: "can I build this?" at a glance.
        part.present?.let { have ->
            val suffices = have >= part.quantity
            Pill(
                if (suffices) stringResource(R.string.partslist_present, fmtInt(have))
                else stringResource(R.string.partslist_present_of, fmtInt(have), fmtInt(part.quantity)),
                if (suffices) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.errorContainer,
                if (suffices) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onErrorContainer,
            )
        }
    }
}

@Composable
private fun Pill(text: String, surface: Color, font: Color) {
    Surface(color = surface, shape = MaterialTheme.shapes.small) {
        Text(text, Modifier.padding(horizontal = Spacing.small, vertical = Spacing.hairline),
            style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = font)
    }
}

/** The legend above the list, once the stock has been entered. */
@Composable
internal fun BuildListsLegend() {
    Text(stringResource(R.string.partslist_legend), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/**
 * Parts by color, minifigures as their own group at the end (key null): they have
 * no color and otherwise stood between the parts under „(Keine Farbe)“.
 */
internal fun buildListsGroups(parts: List<PlPart>): List<Pair<String?, List<PlPart>>> {
    val afterNumber = Comparator<PlPart> { a, b ->
        comparePartNumbers(a.blPartNumber ?: a.partNumber, b.blPartNumber ?: b.partNumber)
    }
    val (figures, parts) = parts.partition { it.isFig }
    val colors: List<Pair<String?, List<PlPart>>> = parts.groupBy { it.colorName }.entries
        .sortedWith(compareBy(plColorCollator) { it.key })
        .map { (color, list) -> color to list.sortedWith(afterNumber) }
    return if (figures.isEmpty()) colors else colors + (null to figures.sortedWith(afterNumber))
}

// PartListViewModel.exportPartsPdf runs the PDF export via a WorkManager worker.
