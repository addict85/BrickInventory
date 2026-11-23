package ch.brickinventoryapp.catalog.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.TileBalance
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.AppCard
import ch.brickinventoryapp.ui.theme.BrickEdgesHistory
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.ui.theme.LocalBrickDecor
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.LocalIsColorSlotsTheme
import ch.brickinventoryapp.ui.theme.LocalIsGloss
import ch.brickinventoryapp.ui.theme.LocalIsStudTheme
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.StudsMass
import ch.brickinventoryapp.ui.theme.StudsSeries
import ch.brickinventoryapp.ui.theme.brickTone
import ch.brickinventoryapp.ui.theme.lightStrip
import ch.brickinventoryapp.ui.theme.slotsTone
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade

@Composable
fun CatalogSetCard(
    set: CatalogSetView,
    imageLoader: ImageLoader,
    serverUrl: String,
    onClick: (String) -> Unit,
    /** Position in the tile wall — only for the cap color of the `noppe` design. */
    position: Int = 0
) {
    val isBrick = LocalIsBrickTheme.current
    val isStud = LocalIsStudTheme.current
    val isGloss = LocalIsGloss.current
    // The theme tone of the `farbfaecher` design — the same formula as
    // --faecher-ton in `js/katalog.js`. Without a theme number there is no
    // stripe, instead of a wrong one.
    val tone = if (LocalIsColorSlotsTheme.current) slotsTone(set.themeId) else null
    val ownership = set.ownedQuantity.coerceAtLeast(1)
    val ownershipAnnouncement = if (set.owned) pluralStringResource(R.plurals.cd_in_collection, ownership, ownership) else null
    // The studs sit above the card: a Material Card clips to its shape.
    // That's why the card moves down by the stud height, and the row is drawn
    // next to it and laid on top — like `top:-6px` in the CSS.
    Box {
        AppCard(
            modifier = Modifier.then(if (isBrick) Modifier.padding(top = StudsMass.Brick.height) else Modifier),
            onClick = { onClick(set.setNumber) },
            onClickLabel = stringResource(R.string.cd_details_open),
        ) {
            Column {
                // The brick edge and brick cap as in the gallery (SetCard).
                if (isBrick) BoxWithConstraints {
                    BrickStudCap(mass = StudsMass.Brick, history = BrickEdgesHistory,
                        height = if (maxWidth < 240.dp) 12.dp else null)
                }
                if (isStud) BrickStudCap(color = brickTone(position), gloss = isGloss)
                if (tone != null) {
                    Box(Modifier.fillMaxWidth().height(5.dp).background(tone))
                }
                // 4:3 like the gallery's tiles: a fixed height left the image standing narrow
                // in the tile on the tablet.
                Box(Modifier.fillMaxWidth().aspectRatio(CATALOG_IMAGE_RATIO)) {
                    CatalogCardImage(set, imageLoader, serverUrl, isBrick, isGloss)
                }
                CatalogCardText(set, ownershipAnnouncement)
            }
        }
        if (isBrick) StudsSeries(
            mass = StudsMass.Brick,
            modifier = Modifier.align(Alignment.TopStart),
            color = LocalBrickDecor.current.studs,
        )
    }
}

/** The set's image with the glass reflection and, if owned, the ownership pill. */
@Composable
private fun BoxScope.CatalogCardImage(set: CatalogSetView, imageLoader: ImageLoader, serverUrl: String, isBrick: Boolean, isGloss: Boolean) {
    val ctx = LocalContext.current
    // Resolved via the server instead of a raw CDN address; if the preview fails,
    // fall back to the full resolution before the placeholder.
    val (thumbUrl, onThumbError) = rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)
    ProductImage(
        model = thumbUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
        imageLoader = imageLoader,
        // Without a description: the name sits below it, TalkBack would otherwise read it twice.
        contentDescription = null,
        onState = { if (it is coil3.compose.AsyncImagePainter.State.Error) onThumbError() },
        modifier = Modifier.fillMaxSize()
            .then(if (isBrick) Modifier else Modifier.clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))),
        contentScale = ContentScale.Fit,
        fallbackSize = 44.dp,
        imageBackground = true,
        innerGap = Spacing.small,
    )
    // The reflection on the glass pane, only above the image (LightStrip in BrickDecor.kt).
    if (isGloss) Box(Modifier.matchParentSize().background(lightStrip()))
    // A pill inside the image like the gallery's quantity badge; read out at the end.
    if (set.owned) {
        Surface(
            color = MaterialTheme.colorScheme.primary,
            shape = Shapes.tag,
            modifier = Modifier.align(Alignment.TopEnd).padding(CATALOG_BADGE_EDGE).clearAndSetSemantics {}
        ) {
            Text(
                if (set.ownedQuantity > 1) "✓ ×${set.ownedQuantity}" else "✓",
                color = MaterialTheme.colorScheme.onPrimary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 6.dp, vertical = Spacing.hairline),
            )
        }
    }
}

/** Name, number, year and parts below the image. */
@Composable
private fun CatalogCardText(set: CatalogSetView, ownershipAnnouncement: String?) {
    // The name first, as it's read aloud; number, year and parts below it.
    // A short name leaves no gap; the line is missing at the bottom (TileBalance).
    var namedRows by remember { mutableIntStateOf(2) }
    Box {
        Column(Modifier.padding(horizontal = Spacing.medium, vertical = Spacing.small),
            verticalArrangement = Arrangement.spacedBy(Spacing.hairline)) {
            Text(set.name ?: "—", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                maxLines = 2, overflow = TextOverflow.Ellipsis, onTextLayout = { namedRows = it.lineCount })
            Text(set.setNumber, Modifier.readAloudAs(stringResource(R.string.cd_set_number, set.setNumber)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val year = set.year
                if (year != null) Text("$year", Modifier.readAloudAs(stringResource(R.string.cd_year, "$year")),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if ((set.numParts ?: 0) > 0) {
                    // The same parts icon as in the "Parts" tab and in the web app.
                    Icon(
                        ImageVector.vectorResource(R.drawable.ic_parts_bricks),
                        contentDescription = null,
                        tint = Color.Unspecified,
                        modifier = Modifier.size(withFont(13.dp))
                    )
                    // The number with a word: "500" alone next to the brick icon read like a price.
                    val parts = set.numParts ?: 0
                    Text(pluralStringResource(R.plurals.gallery_stat_parts, parts, fmtInt(parts)),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            TileBalance(2 - namedRows)
        }
        if (ownershipAnnouncement != null) Box(Modifier.semantics { contentDescription = ownershipAnnouncement })
    }
}

/** Aspect ratio of tile images, as in the gallery. */
private const val CATALOG_IMAGE_RATIO = 4f / 3f

/** Distance of the ownership badge from the image edge, as in the gallery. */
private val CATALOG_BADGE_EDGE = Spacing.small + Spacing.tiny

/**
 * Placeholder for a slot whose page isn't loaded yet — the same height
 * as a real tile, otherwise the list jumps on arrival, and a jump
 * to a year boundary landed off target.
 */
@Composable
internal fun CatalogPlaceholderCard() {
    Card(
        shape = Shapes.bar,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
        modifier = Modifier.fillMaxWidth().height(200.dp).testTag(PLACEHOLDER_TAG)
    ) {}
}

/** A slot without its set yet; the tests compare its height with a tile's. */
internal const val PLACEHOLDER_TAG = "catalog-placeholder"
