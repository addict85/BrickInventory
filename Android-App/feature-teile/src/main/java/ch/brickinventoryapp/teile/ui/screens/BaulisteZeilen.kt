package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.teile.ui.PlPart
import androidx.compose.ui.semantics.contentDescription
import ch.brickinventoryapp.ui.theme.farbeAusHex
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.vorgelesenAls
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.bewegungReduziert
import ch.brickinventoryapp.ui.components.farbUebersetzer
import ch.brickinventoryapp.ui.components.katalogName
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.ui.mengeAusSet

/** PDF der fertigen Liste; ein Fehler kommt als Dialog. Der Export läuft im ViewModel. */
@Composable
internal fun PdfKnopf(isExporting: Boolean, pdfError: String?, onExport: () -> Unit, onFehlerGesehen: () -> Unit) {
    if (pdfError != null) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = onFehlerGesehen,
            confirmButton = { TextButton(onClick = onFehlerGesehen) { Text(stringResource(R.string.common_ok)) } },
            title = { Text(stringResource(R.string.partslist_pdf_error_title)) },
            text = { Text(pdfError) }
        )
    }
    FilledTonalButton(
        onClick = onExport,
        enabled = !isExporting,
    ) {
        // Nur das Symbol wird zum Kreisel, die Beschriftung bleibt (wie oben).
        if (isExporting) CircularProgressIndicator(Modifier.size(16.dp),
            strokeWidth = 2.dp)
        else Icon(Icons.Default.PictureAsPdf, null, Modifier.size(mitSchrift(16.dp)))
        Spacer(Modifier.width(Abstaende.winzig))
        Text(stringResource(R.string.common_pdf))
    }
}

/** Kopf einer Farbgruppe: Farbpunkt, Name und wie viele Teile und Typen sie hat. */
@Composable
internal fun FarbGruppenKopf(colorName: String, colorParts: List<PlPart>) {
    val mengen = androidx.compose.ui.platform.LocalResources.current
    val farbe = farbUebersetzer()
    Row(verticalAlignment = Alignment.CenterVertically) {
        val hex = colorParts.first().colorHex
        if (hex != null && !colorParts.first().isFig) {
            Box(Modifier.size(14.dp).clip(CircleShape)
                .background(farbeAusHex(hex) ?: Color.Gray))
            Spacer(Modifier.width(6.dp))
        }
        val displayName = if (colorName.isEmpty()) stringResource(R.string.partslist_no_color) else farbe(colorName)
        Text(displayName, fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(Abstaende.klein))
        // Uebereinstimmung mit %2$d (den Typen) — %1$d traegt
        // nur ein „×" und kein Wort.
        Text(mengen.getQuantityString(R.plurals.partslist_group_summary,
                colorParts.size, colorParts.sumOf { it.quantity }, colorParts.size),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider(Modifier.padding(top = Abstaende.winzig), color = MaterialTheme.colorScheme.primaryContainer)
}

@Composable
fun PartListRow(
    part: PlPart,
    serverUrl: String,
    imageLoader: ImageLoader,
) {
    val ctx = LocalContext.current
    val rbPrefixFmt = stringResource(R.string.partslist_rb_prefix)
    // part.imageUrl ist schon aufgelöst (ui/Teileliste.kt); ein zweites
    // resolveThumbUrl() wickelte die Proxy-Adresse doppelt ein. Nur ein relativer Pfad
    // bekommt den Server davor.
    val imgUrl = remember(part.imageUrl, serverUrl) {
        part.imageUrl?.let { url ->
            if (url.startsWith("/")) "$serverUrl$url" else url
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(vertical = Abstaende.winzig),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Image
        ProduktBild(
            model = imgUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!bewegungReduziert()).build() },
            imageLoader = imageLoader,
            contentDescription = part.partName,
            modifier = Modifier.size(48.dp).clip(MaterialTheme.shapes.small),
            contentScale = ContentScale.Fit,
            ersatzGroesse = 24.dp,
        )
        // Info
        Column(Modifier.weight(1f)) {
            // BL-ID (primary) and RB-ID (secondary)
            val displayId = part.blPartNumber ?: part.partNumber
            Text(displayId, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            if (part.blPartNumber != null && part.blPartNumber != part.partNumber) {
                Text(String.format(rbPrefixFmt, part.partNumber), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(katalogName(part.partName), style = MaterialTheme.typography.bodySmall,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        // Quantity badge
        Surface(color = if (part.isFig) MaterialTheme.colorScheme.tertiaryContainer
                        else MaterialTheme.colorScheme.primaryContainer,
                shape = MaterialTheme.shapes.small) {
            Text(mengeAusSet(part.quantity), Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.winzig)
                .vorgelesenAls(stueckzahl(part.quantity)),
                fontWeight = FontWeight.Bold,
                color = if (part.isFig) MaterialTheme.colorScheme.onTertiaryContainer
                        else MaterialTheme.colorScheme.onPrimaryContainer)
        }
        // ── „habe ich“ neben „brauche ich“ ──
        //
        // Wie viele Stück im Blickfeld liegen, sagt der Server. Grün, wenn es reicht,
        // sonst der Fehlbetrag in Rot — „kann ich das bauen?“ ist so schon beim
        // Überfliegen beantwortet.
        part.vorhanden?.let { habe ->
            val reicht = habe >= part.quantity
            Surface(
                color = if (reicht) MaterialTheme.colorScheme.secondaryContainer
                        else MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(
                    if (reicht) "✓ $habe" else "$habe/${part.quantity}",
                    Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.winzig),
                    fontWeight = FontWeight.Bold,
                    color = if (reicht) MaterialTheme.colorScheme.onSecondaryContainer
                            else MaterialTheme.colorScheme.onErrorContainer,
                )
            }
        }
    }
}

// Den PDF-Export führt TeilelisteViewModel.exportPartsPdf über den Vordergrund-Dienst.
