package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.model.domain.Waehrung
import androidx.compose.material3.Button
import ch.brickinventoryapp.ui.components.focusFrame
import ch.brickinventoryapp.ui.theme.colorFromHex
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.TeilAnsicht
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.farbTranslator
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.catalogName
import ch.brickinventoryapp.ui.components.categoryTranslator
import ch.brickinventoryapp.shared.ui.SparePartBadge
import ch.brickinventoryapp.shared.ui.ManuelleKachel
import ch.brickinventoryapp.shared.ui.TabellenZeile
import ch.brickinventoryapp.shared.ui.mengeAusSet

@Composable
internal fun ManualPartTile(part: ManualPartView, serverUrl: String, imageLoader: ImageLoader,
                   waehrung: Waehrung, onEdit: () -> Unit) {
    val farbe = remember(part.colorHex) {
        colorFromHex(part.colorHex)
    }
    // On the user's request, even the full resolution (fallback) runs through
    // the server proxy, not directly to the CDN — unlike for sets/catalog.
    val (bild, onBildFehler) =
        rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // A tile shared with the minifigures — see ManuelleKachel.
    ManuelleKachel(
        bildUrl = bild,
        onBildFehler = onBildFehler,
        imageLoader = imageLoader,
        name = part.partName ?: part.partNumber,
        menge = part.quantity,
        states = part.conditions,
        zustand = part.condition,
        besitzer = part.owners,
        preis = part.avgPurchasePrice ?: part.unitPrice ?: part.purchasePrice,
        waehrung = waehrung,
        onEdit = onEdit,
        farbe = farbe,
        farbname = part.colorName?.let { farbTranslator()(it) },
    )
}

/** Image area of the part tile: grows with the tile, about 90 dp tall on the phone as before. */
private const val PART_IMAGE_RATIO = 4f / 3f

@Composable
fun PartCard(part: TeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
             onClick: (() -> Unit)? = null, ausgewaehlt: Boolean = false) {
    val ctx = LocalContext.current
    val qty = part.totalQuantity.takeIf { it > 0 } ?: 1
    val colorObj = remember(part.colorHex) {
        colorFromHex(part.colorHex)
    }
    // On the user's request, even the full resolution (fallback) runs through
    // the server proxy, not directly to the CDN — unlike for sets/catalog.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // From large font on, a list row like the sets: the image at full width
    // left room for one part per screen. The quantity then moves from the image into the text.
    val zeile = largeFont()
    val weich = !movementReduced()
    val menge: @Composable () -> Unit = {
        Surface(color = MaterialTheme.colorScheme.primary, shape = Formen.marke) {
            Text(mengeAusSet(qty), Modifier.padding(horizontal = Abstaende.tiny, vertical = 1.dp)
                .readAloudAs(stueckzahl(qty)),
                color = MaterialTheme.colorScheme.onPrimary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }

    // Growing with the tile instead of a fixed 90 dp: on the tablet a small
    // image otherwise stood above a wide tile.
    val canvas: @Composable (Modifier) -> Unit = { flaeche ->
        Box(flaeche) {
            ProduktBild(
                model = imageUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(weich).build() },
                imageLoader = imageLoader,
                // Without a description: the name stands below it, TalkBack would otherwise read it twice.
                contentDescription = null,
                onState = { st ->
                    if (st is coil3.compose.AsyncImagePainter.State.Error) onImageError()
                },
                modifier = Modifier.fillMaxSize()
                    .clip(Formen.kachelBildEcken),
                contentScale = ContentScale.Fit,
                fallbackSize = 32.dp,
                // The image background across the whole tile width as with the sets: a narrow
                // image otherwise stood as a box with white margins in the card.
                bildgrund = true,
                innerGap = Abstaende.tiny,
            )
            if (!zeile) Box(Modifier.align(Alignment.TopEnd).padding(Abstaende.tiny)) { menge() }
            // Color dot
            if (colorObj != null) {
                Box(
                    Modifier.size(14.dp).align(Alignment.BottomStart).padding(3.dp)
                        .clip(CircleShape).background(colorObj)
                )
            }
        }
    }

    val texts: @Composable (Modifier) -> Unit = { column ->
        Column(column.padding(horizontal = 7.dp, vertical = 5.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            if (zeile) menge()
            val nummer = part.blPartNumber ?: part.partNumber
            Text(nummer, Modifier.readAloudAs(stringResource(R.string.cd_teil_nummer, nummer)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold)
            Text(part.partName?.let { catalogName(it) }
                    ?: androidx.compose.ui.text.AnnotatedString(stringResource(R.string.name_unknown)),
                style = MaterialTheme.typography.bodySmall,
                color = if (part.partName == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                // Always room for two lines in the grid: tiles of a row are equally high,
                // even when a name is short. The row does not have to resemble anyone else's.
                minLines = if (zeile) 1 else 2,
                maxLines = if (zeile) 4 else 2, overflow = TextOverflow.Ellipsis)
            part.colorName?.let {
                Text(farbTranslator()(it), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            // Spare part — sets include a small bag of them. Only when it
            // IS one: a badge "kein Ersatzteil" on every tile
            // would be noise.
            if (part.isSpare) SparePartBadge(Modifier.padding(top = Abstaende.hairline))
        }
    }

    Card(
        // Tapping opens the detail dialog, as for manually entered parts.
        modifier = Modifier.fillMaxWidth().heightIn(min = if (zeile) 0.dp else 164.dp)
            .semantics { selected = ausgewaehlt }
            .then(if (ausgewaehlt) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Formen.leiste) else Modifier)
            .let { if (onClick != null) it.focusFrame(Formen.leiste).clickable(role = Role.Button, onClick = onClick) else it },
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        if (zeile) Row(verticalAlignment = Alignment.Top) {
            canvas(Modifier.width(ROW_IMAGE_WIDTH).aspectRatio(PART_IMAGE_RATIO))
            texts(Modifier.weight(1f))
        } else Column {
            canvas(Modifier.fillMaxWidth().aspectRatio(PART_IMAGE_RATIO))
            texts(Modifier)
        }
    }
}

/** Width of the thumbnail when the tile is a list row at large font. */
private val ROW_IMAGE_WIDTH = 96.dp

/** Section heading inside the grids (manually entered / from sets). */
@Composable
internal fun SectionHeader(text: String) {
    SectionTitle(text,
        Modifier.padding(horizontal = Abstaende.hairline, vertical = Abstaende.tiny))
}

/**
 * A part as a table row.
 * Category and sets stand as a second line below it, because seven columns like in the
 * web app fit on no phone.
 */
@Composable
internal fun PartTableRow(part: TeilAnsicht, serverUrl: String, imageLoader: ImageLoader,
                 onClick: (() -> Unit)? = null) {
    val farbe = remember(part.colorHex) {
        colorFromHex(part.colorHex)
    }
    val (bildUrl, onError) = rememberTileImageWithFallback(
        serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Category and sets in one line, separated by "·" — and only what is
    // there. An empty " · " looks like a missing value.
    val ersatzteil = stringResource(R.string.parts_spare_tag)
    val kategorie = categoryTranslator()
    val zweite = listOfNotNull(
        part.categoryName?.takeIf { it.isNotBlank() }?.let(kategorie),
        part.inSets?.takeIf { it.isNotBlank() }?.replace(",", ", "),
        // In the table row as a word instead of a badge: the row is built for
        // density, a surface with its own background would look in it
        // like a button.
        ersatzteil.takeIf { part.isSpare },
    ).joinToString(" · ").ifBlank { null }

    TabellenZeile(
        bildUrl = bildUrl,
        nummer = part.blPartNumber ?: part.partNumber,
        name = part.partName,
        menge = part.totalQuantity.takeIf { it > 0 } ?: 1,
        imageLoader = imageLoader,
        farbe = farbe,
        secondRow = zweite,
        onBildFehler = onError,
        onClick = onClick,
    )
}
