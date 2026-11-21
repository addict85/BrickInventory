package ch.brickinventoryapp.ui.components

import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridItemScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.skeletonTone

/**
 * Tiles without content, as long as the first page is loading. The surface already
 * looks the way the list will look in a moment — image area and two text bars per
 * tile, on request the key-figures row above it —, so nothing jumps when it arrives.
 */
@Composable
fun SkeletonRaster(
    spalten: GridCells,
    kachelHoehe: Dp,
    modifier: Modifier = Modifier,
    anzahl: Int = 12,
    innenabstand: PaddingValues = PaddingValues(Abstaende.mittel),
    abstand: Dp = 10.dp,
    /** A row across the full width up front, where the list shows key figures (gallery). */
    headerRow: Boolean = false,
    /**
     * Aspect ratio of the image area, where the real tile has one (gallery 4:3).
     * Without it, the image takes the rest of the height; with it, nothing jumps when it arrives.
     */
    imageRatio: Float? = null,
) {
    val laedt = stringResource(R.string.common_loading)
    // One shimmer for all tiles: if it runs across all of them together, it reads as one
    // surface loading. The tone comes from skeletonTone (Theme.kt), so the tiles
    // stand out from the background in every theme.
    val weg by rememberInfiniteTransition(label = "skelett").animateFloat(
        initialValue = -600f, targetValue = 1800f,
        animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart),
        label = "skelett-schimmer",
    )
    val grund = skeletonTone(MaterialTheme.colorScheme)
    val light = skeletonTone(MaterialTheme.colorScheme, 0.04f)
    // Without motion, a calm surface instead of the traveling light.
    val schimmer = if (movementReduced()) SolidColor(grund) else Brush.linearGradient(listOf(grund, light, grund),
        start = Offset(weg, 0f), end = Offset(weg + 600f, 600f))
    LazyVerticalGrid(
        columns = spalten,
        modifier = modifier.fillMaxSize().semantics { contentDescription = laedt; liveRegion = LiveRegionMode.Polite },
        contentPadding = innenabstand,
        horizontalArrangement = Arrangement.spacedBy(abstand),
        verticalArrangement = Arrangement.spacedBy(abstand),
        userScrollEnabled = false,
    ) {
        if (headerRow) item(key = "skelett-kopf", span = { GridItemSpan(maxLineSpan) }) {
            Box(Modifier.fillMaxWidth().height(SKELETON_HEADER).clip(Formen.karte).background(schimmer))
        }
        items(anzahl, key = { "skelett-$it" }) {
            // Like a card: a surface, with an image and two lines of text as bars inside.
            Column(
                Modifier.fillMaxWidth().height(kachelHoehe).clip(Formen.leiste)
                    .background(MaterialTheme.colorScheme.surface).padding(Abstaende.klein),
                verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
            ) {
                val bild = if (imageRatio != null) Modifier.aspectRatio(imageRatio) else Modifier.weight(1f)
                Box(Modifier.fillMaxWidth().then(bild).clip(Formen.kachel).background(schimmer))
                Box(Modifier.fillMaxWidth(0.8f).height(Abstaende.mittel).clip(Formen.strich).background(schimmer))
                Box(Modifier.fillMaxWidth(0.5f).height(Abstaende.mittel).clip(Formen.strich).background(schimmer))
            }
        }
    }
}

/** Height of the key-figures row in the skeleton — as tall as the real one at 100%. */
private val SKELETON_HEADER = 88.dp

/**
 * An entry that glides instead of jumping when inserted, removed and
 * reordered. As a wrapper instead of a parameter on every tile: the tiles are
 * also used outside lists, where animateItem() doesn't apply.
 */
@Composable
fun LazyGridItemScope.Moved(inhalt: @Composable () -> Unit) {
    Box(if (movementReduced()) Modifier else Modifier.animateItem(), propagateMinConstraints = true) { inhalt() }
}

/** The same for entries of a LazyColumn. */
@Composable
fun LazyItemScope.Moved(inhalt: @Composable () -> Unit) {
    Box(if (movementReduced()) Modifier else Modifier.animateItem(), propagateMinConstraints = true) { inhalt() }
}
