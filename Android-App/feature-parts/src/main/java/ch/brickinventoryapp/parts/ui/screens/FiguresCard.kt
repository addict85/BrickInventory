package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.Button
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.Origin
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.ConditionBadges
import ch.brickinventoryapp.shared.ui.ManualTile
import ch.brickinventoryapp.shared.ui.ManualTileItem
import ch.brickinventoryapp.shared.ui.OwnerBadges
import ch.brickinventoryapp.shared.ui.TableRow
import ch.brickinventoryapp.shared.ui.quantityFromSet
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.catalogName
import ch.brickinventoryapp.ui.components.focusFrame
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.quantity
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import coil3.ImageLoader

@Composable
internal fun ManualFigTile(fig: ManualMinifigView, serverUrl: String, imageLoader: ImageLoader,
                  currency: CurrencyCode, onEdit: () -> Unit) {
    // Thumbnail with a fallback to full resolution — see
    // util/ImageFallback.kt, rememberTileImageWithFallback().
    val (image, onImageError) =
        rememberTileImageWithFallback(serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
    // Everything else lives in ManualTile (ManualItemComposables.kt), which the
    // parts also use — so that condition and owner badges are not maintained in only
    // one twin.
    ManualTile(
        item = ManualTileItem(
            name = fig.figName ?: fig.figNumber,
            quantity = fig.quantity,
            states = fig.conditions,
            condition = fig.condition,
            owner = fig.owners,
            price = fig.avgPurchasePrice ?: fig.unitPrice ?: fig.purchasePrice,
        ),
        currency = currency,
        imageUrl = image,
        onImageError = onImageError,
        imageLoader = imageLoader,
        onEdit = onEdit,
    )
}

@Composable
fun MinifigCard(fig: FigureView, serverUrl: String, imageLoader: ImageLoader,
                onClick: (() -> Unit)? = null, picked: Boolean = false) {
    val qty = fig.totalQuantity ?: fig.quantity

    Card(
        // Tapping opens the detail dialog — as with the parts next to it.
        modifier = Modifier.fillMaxWidth().heightIn(min = 196.dp)
            .semantics { selected = picked }
            .then(if (picked) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Shapes.bar) else Modifier)
            .let { if (onClick != null) it.focusFrame(Shapes.bar).clickable(role = Role.Button, onClick = onClick) else it },
        shape = Shapes.bar,
        elevation = CardDefaults.cardElevation(defaultElevation = Shapes.cardElevation),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column {
            MinifigCardImage(fig, serverUrl, imageLoader, qty)
            MinifigCardTexts(fig)
        }
    }
}

/**
 * A figure as a table row: image, number, name, quantity, entry date — what
 * the web app's table shows (renderFigs in `minifigs.js`). No columns
 * for "source" or trash can: this list only loads `source=set`, and both would be
 * constant.
 */
@Composable
internal fun MinifigTableRow(fig: FigureView, serverUrl: String, imageLoader: ImageLoader,
                    onClick: (() -> Unit)? = null) {
    val (imageUrl, onError) = rememberTileImageWithFallback(
        serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
    TableRow(
        imageUrl = imageUrl,
        number = fig.figNumber,
        name = fig.figName,
        quantity = fig.totalQuantity ?: fig.quantity,
        imageLoader = imageLoader,
        secondRow = fmtTag(fig.setAddedAt),
        onImageError = onError,
        onClick = onClick,
    )
}

/** The figure's image with quantity, condition, owner and the "manual" badge. */
@Composable
private fun MinifigCardImage(fig: FigureView, serverUrl: String, imageLoader: ImageLoader, qty: Int) {
    Box(Modifier.fillMaxWidth().height(110.dp)) {
        // Thumbnail with a fallback to full resolution — see
        // util/ImageFallback.kt, rememberTileImageWithFallback().
        val (figImg, onFigImgError) = rememberTileImageWithFallback(serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
        ProductImage(
            model = figImg,
            imageLoader = imageLoader,
            // Without a description: the name stands below it, TalkBack would otherwise read it twice.
            contentDescription = null,
            onState = { st ->
                if (st is coil3.compose.AsyncImagePainter.State.Error) onFigImgError()
            },
            modifier = Modifier.fillMaxSize()
                .clip(Shapes.tileImageCorners),
            contentScale = ContentScale.Fit,
            // Image background across the whole tile width as with sets and parts: the tall
            // figure image otherwise stood narrow in the middle with white margins.
            imageBackground = true,
            innerGap = Spacing.tiny,
        )
        if (qty > 1) {
            Surface(
                color = MaterialTheme.colorScheme.primary,
                shape = Shapes.brand,
                modifier = Modifier.align(Alignment.TopEnd).padding(Spacing.tiny)
            ) {
                // The quantity badge: "×N" on a manually entered tile, "N×" on
                // a tile from a set — the web app's rule (`man-tile` with
                // `qbadge` ×N, `part-card` with `part-qty` N×).
                Text(quantityFromSet(qty), Modifier.padding(horizontal = 5.dp, vertical = Spacing.hairline)
                    .readAloudAs(quantity(qty)),
                    color = MaterialTheme.colorScheme.onPrimary,
                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            }
        }
        // Condition only for manually entered minifigures (ones taken over from sets have none
        // of their own). The owner badge, however, always: "whose is this?" comes up just
        // the same for a figure from a child's set, and this list only loads
        // `source=set`. Without a household, `owners` is empty and OwnerBadges returns
        // right away. Column instead of Box: two badges stacked, not at the same point.
        Column(Modifier.align(Alignment.BottomStart).padding(Spacing.tiny),
            verticalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
            if (fig.source == Origin.MANUAL) ConditionBadges(fig.conditions, fig.condition)
            OwnerBadges(fig.owners)
        }
        if (fig.source == Origin.MANUAL) {
            Surface(
                color = MaterialTheme.colorScheme.tertiaryContainer,
                shape = Shapes.brand,
                modifier = Modifier.align(Alignment.TopStart).padding(Spacing.tiny)
            ) {
                Text(stringResource(R.string.minifigs_manual_badge), Modifier.padding(horizontal = 5.dp, vertical = Spacing.hairline),
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** Number, name and the date it came with its set. */
@Composable
private fun MinifigCardTexts(fig: FigureView) {
    Column(Modifier.padding(Spacing.small), verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(fig.figNumber, Modifier.readAloudAs(stringResource(R.string.cd_figure_number, fig.figNumber)),
            style = MaterialTheme.typography.bodySmall,
            // A number, not a link: primary blue is for what can be tapped.
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
        // The number already stands above it; without a name, the same number again looked like a name.
        val figName = fig.figName
        if (figName != null) {
            Text(catalogName(figName),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                maxLines = if (largeFont()) 3 else 2, overflow = TextOverflow.Ellipsis)
        } else {
            Text(stringResource(R.string.name_unknown), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        // A shared helper (util/DatumFormat.kt): it also handles timestamps without
        // milliseconds.
        val dateLabel = remember(fig.setAddedAt) {
            fmtTag(fig.setAddedAt, DateYear.SHORT)
        }
        if (dateLabel != null)
            Text(dateLabel, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
