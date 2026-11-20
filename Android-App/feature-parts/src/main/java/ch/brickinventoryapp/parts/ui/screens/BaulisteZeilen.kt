package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.ui.theme.fensterFlaeche
import androidx.compose.ui.semantics.contentDescription
import ch.brickinventoryapp.ui.theme.colorFromHex
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.runtime.*
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.farbTranslator
import ch.brickinventoryapp.ui.components.catalogName
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.util.fmtInt

/** PDF der fertigen Liste; ein Fehler kommt als Dialog. Der Export läuft im ViewModel. */
@Composable
internal fun PdfButton(exportRunning: Boolean, pdfError: String?, onExport: () -> Unit, onErrorSeen: () -> Unit) {
    if (pdfError != null) {
        val titel = stringResource(R.string.partslist_pdf_error_title)
        androidx.compose.material3.AlertDialog(
            containerColor = fensterFlaeche(),
            onDismissRequest = onErrorSeen,
            modifier = Modifier.semantics { paneTitle = titel },
            confirmButton = { TextButton(onClick = onErrorSeen) { Text(stringResource(R.string.common_ok)) } },
            title = { Text(titel, Modifier.semantics { heading() }) },
            text = { Text(pdfError) }
        )
    }
    // Umrandet wie jede Nebenaktion: Die getönte Fläche lag im hellen Design kaum über dem Grund.
    OutlinedButton(
        onClick = onExport,
        enabled = !exportRunning,
        colors = nebenKnopfFarben(),
        border = nebenKnopfRand(!exportRunning),
    ) {
        // Nur das Symbol wird zum Kreisel, die Beschriftung bleibt (wie oben).
        if (exportRunning) CircularProgressIndicator(Modifier.size(16.dp),
            strokeWidth = 2.dp)
        else Icon(Icons.Default.PictureAsPdf, null, Modifier.size(withFont(16.dp)))
        Spacer(Modifier.width(Abstaende.tiny))
        Text(stringResource(R.string.common_pdf))
    }
}

/** Kopf einer Farbgruppe: Farbpunkt, Name und wie viele Teile und Typen sie hat; [colorName] null = Minifiguren. */
@Composable
internal fun FarbGroupsHeader(colorName: String?, colorParts: List<PlPart>) {
    val quantities = androidx.compose.ui.platform.LocalResources.current
    val farbe = farbTranslator()
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
            else -> farbe(colorName)
        }
        Text(displayName, fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(Abstaende.klein))
        // Uebereinstimmung mit %2$d (den Typen) — %1$d traegt
        // nur ein „×" und kein Wort.
        Text(quantities.getQuantityString(R.plurals.partslist_group_summary,
                colorParts.size, colorParts.sumOf { it.quantity }, colorParts.size),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider(Modifier.padding(top = Abstaende.tiny), color = MaterialTheme.colorScheme.primaryContainer)
}

@Composable
internal fun PartListRow(
    part: PlPart,
    serverUrl: String,
    imageLoader: ImageLoader,
) {
    val ctx = LocalContext.current
    // part.imageUrl ist schon aufgelöst (ui/Teileliste.kt); ein zweites
    // resolveThumbUrl() wickelte die Proxy-Adresse doppelt ein. Nur ein relativer Pfad
    // bekommt den Server davor.
    val imgUrl = remember(part.imageUrl, serverUrl) {
        part.imageUrl?.let { url ->
            if (url.startsWith("/")) "$serverUrl$url" else url
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(vertical = Abstaende.tiny),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Image
        ProduktBild(
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
            Text(displayId, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
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
 * Was die Liste braucht und was im Bestand liegt, ausgeschrieben statt „×12“ und „✓ 8“:
 * Ohne Legende las niemand, welche Zahl welche war. Unter dem Namen statt rechts daneben,
 * damit bei grosser Schrift der Name nicht auf ein Wort je Zeile schrumpft.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuantitiesPills(part: PlPart) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny),
        verticalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
        Pill(stringResource(R.string.partslist_benoetigt, fmtInt(part.quantity)),
            if (part.isFig) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.primaryContainer,
            if (part.isFig) MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onPrimaryContainer)
        // Grün, wenn es reicht, sonst rot mit dem Fehlbetrag: „kann ich das bauen?“ beim Überfliegen.
        part.vorhanden?.let { habe ->
            val reicht = habe >= part.quantity
            Pill(
                if (reicht) stringResource(R.string.partslist_vorhanden, fmtInt(habe))
                else stringResource(R.string.partslist_vorhanden_von, fmtInt(habe), fmtInt(part.quantity)),
                if (reicht) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.errorContainer,
                if (reicht) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onErrorContainer,
            )
        }
    }
}

@Composable
private fun Pill(text: String, flaeche: Color, schrift: Color) {
    Surface(color = flaeche, shape = MaterialTheme.shapes.small) {
        Text(text, Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.hairline),
            style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = schrift)
    }
}

/** Die Legende über der Liste, sobald der Bestand eingetragen ist. */
@Composable
internal fun BuildListsLegend() {
    Text(stringResource(R.string.partslist_legende), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/**
 * Teile nach Farbe, die Minifiguren als eigene Gruppe am Ende (Schlüssel null): Sie haben
 * keine Farbe und standen sonst zwischen den Teilen unter „(Keine Farbe)“.
 */
internal fun buildListsGroups(parts: List<PlPart>): List<Pair<String?, List<PlPart>>> {
    val afterNumber = Comparator<PlPart> { a, b ->
        comparePartNumbers(a.blPartNumber ?: a.partNumber, b.blPartNumber ?: b.partNumber)
    }
    val (figuren, teile) = parts.partition { it.isFig }
    val farben: List<Pair<String?, List<PlPart>>> = teile.groupBy { it.colorName }.entries
        .sortedWith(compareBy(plColorCollator) { it.key })
        .map { (farbe, liste) -> farbe to liste.sortedWith(afterNumber) }
    return if (figuren.isEmpty()) farben else farben + (null to figuren.sortedWith(afterNumber))
}

// Den PDF-Export führt PartListViewModel.exportPartsPdf über den Vordergrund-Dienst.
