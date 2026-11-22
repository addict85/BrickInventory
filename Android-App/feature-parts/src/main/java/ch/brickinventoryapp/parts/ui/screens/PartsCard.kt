package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.Button
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.ManualTile
import ch.brickinventoryapp.shared.ui.ManualTileItem
import ch.brickinventoryapp.shared.ui.SparePartBadge
import ch.brickinventoryapp.shared.ui.TableRow
import ch.brickinventoryapp.shared.ui.quantityFromSet
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.catalogName
import ch.brickinventoryapp.ui.components.categoryTranslator
import ch.brickinventoryapp.ui.components.colorTranslator
import ch.brickinventoryapp.ui.components.focusFrame
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.quantity
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.colorFromHex
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade

@Composable
internal fun ManualPartTile(part: ManualPartView, serverUrl: String, imageLoader: ImageLoader,
                   currency: CurrencyCode, onEdit: () -> Unit) {
    val color = remember(part.colorHex) {
        colorFromHex(part.colorHex)
    }
    // On the user's request, even the full resolution (fallback) runs through
    // the server proxy, not directly to the CDN — unlike for sets/catalog.
    val (image, onImageError) =
        rememberTileImageWithFallback(serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // A tile shared with the minifigures — see ManualTile.
    ManualTile(
        item = ManualTileItem(
            name = part.partName ?: part.partNumber,
            quantity = part.quantity,
            states = part.conditions,
            condition = part.condition,
            owner = part.owners,
            price = part.avgPurchasePrice ?: part.unitPrice ?: part.purchasePrice,
        ),
        currency = currency,
        imageUrl = image,
        onImageError = onImageError,
        imageLoader = imageLoader,
        onEdit = onEdit,
        color = color,
        colorName = part.colorName?.let { colorTranslator()(it) },
    )
}

/** Image area of the part tile: grows with the tile, about 90 dp tall on the phone as before. */
private const val PART_IMAGE_RATIO = 4f / 3f

@Composable
fun PartCard(part: PartView, serverUrl: String, imageLoader: ImageLoader,
             onClick: (() -> Unit)? = null, picked: Boolean = false) {
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
    val row = largeFont()
    val soft = !movementReduced()
    val quantity: @Composable () -> Unit = {
        Surface(color = MaterialTheme.colorScheme.primary, shape = Shapes.brand) {
            Text(quantityFromSet(qty), Modifier.padding(horizontal = Spacing.tiny, vertical = 1.dp)
                .readAloudAs(quantity(qty)),
                color = MaterialTheme.colorScheme.onPrimary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }

    // Growing with the tile instead of a fixed 90 dp: on the tablet a small
    // image otherwise stood above a wide tile.
    val canvas: @Composable (Modifier) -> Unit = { surface ->
        Box(surface) {
            ProductImage(
                model = imageUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(soft).build() },
                imageLoader = imageLoader,
                // Without a description: the name stands below it, TalkBack would otherwise read it twice.
                contentDescription = null,
                onState = { st ->
                    if (st is coil3.compose.AsyncImagePainter.State.Error) onImageError()
                },
                modifier = Modifier.fillMaxSize()
                    .clip(Shapes.tileImageCorners),
                contentScale = ContentScale.Fit,
                fallbackSize = 32.dp,
                // The image background across the whole tile width as with the sets: a narrow
                // image otherwise stood as a box with white margins in the card.
                imageBackground = true,
                innerGap = Spacing.tiny,
            )
            if (!row) Box(Modifier.align(Alignment.TopEnd).padding(Spacing.tiny)) { quantity() }
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
            if (row) quantity()
            val number = part.blPartNumber ?: part.partNumber
            // A number, not a link: primary blue is for what can be tapped.
            Text(number, Modifier.readAloudAs(stringResource(R.string.cd_part_number, number)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.SemiBold)
            Text(part.partName?.let { catalogName(it) }
                    ?: androidx.compose.ui.text.AnnotatedString(stringResource(R.string.name_unknown)),
                style = MaterialTheme.typography.bodySmall,
                color = if (part.partName == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                // Always room for two lines in the grid: tiles of a row are equally high,
                // even when a name is short. The row does not have to resemble anyone else's.
                minLines = if (row) 1 else 2,
                maxLines = if (row) 4 else 2, overflow = TextOverflow.Ellipsis)
            part.colorName?.let {
                Text(colorTranslator()(it), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            // Spare part — sets include a small bag of them. Only when it
            // IS one: a badge "kein Ersatzteil" on every tile
            // would be noise.
            if (part.isSpare) SparePartBadge(Modifier.padding(top = Spacing.hairline))
        }
    }

    Card(
        // Tapping opens the detail dialog, as for manually entered parts.
        modifier = Modifier.fillMaxWidth().heightIn(min = if (row) 0.dp else 164.dp)
            .semantics { selected = picked }
            .then(if (picked) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Shapes.bar) else Modifier)
            .let { if (onClick != null) it.focusFrame(Shapes.bar).clickable(role = Role.Button, onClick = onClick) else it },
        shape = Shapes.bar,
        elevation = CardDefaults.cardElevation(defaultElevation = Shapes.cardElevation),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        if (row) Row(verticalAlignment = Alignment.Top) {
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
        Modifier.padding(horizontal = Spacing.hairline, vertical = Spacing.tiny))
}

/**
 * A part as a table row.
 * Category and sets stand as a second line below it, because seven columns like in the
 * web app fit on no phone.
 */
@Composable
internal fun PartTableRow(part: PartView, serverUrl: String, imageLoader: ImageLoader,
                 onClick: (() -> Unit)? = null) {
    val color = remember(part.colorHex) {
        colorFromHex(part.colorHex)
    }
    val (imageUrl, onError) = rememberTileImageWithFallback(
        serverUrl, part.imageLocal, part.imageUrl, fullViaProxy = true)
    // Category and sets in one line, separated by "·" — and only what is
    // there. An empty " · " looks like a missing value.
    val sparePart = stringResource(R.string.parts_spare_tag)
    val category = categoryTranslator()
    val second = listOfNotNull(
        part.categoryName?.takeIf { it.isNotBlank() }?.let(category),
        part.inSets?.takeIf { it.isNotBlank() }?.replace(",", ", "),
        // In the table row as a word instead of a badge: the row is built for
        // density, a surface with its own background would look in it
        // like a button.
        sparePart.takeIf { part.isSpare },
    ).joinToString(" · ").ifBlank { null }

    TableRow(
        imageUrl = imageUrl,
        number = part.blPartNumber ?: part.partNumber,
        name = part.partName,
        quantity = part.totalQuantity.takeIf { it > 0 } ?: 1,
        imageLoader = imageLoader,
        color = color,
        secondRow = second,
        onImageError = onError,
        onClick = onClick,
    )
}
