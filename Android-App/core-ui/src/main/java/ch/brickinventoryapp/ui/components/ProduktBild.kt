package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.luminance
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import coil3.request.ImageRequest

/** Test tag of the placeholder image — UI tests use it to count empty image areas. */
const val IMAGE_FALLBACK = "bild-ersatz"

/**
 * Every image area of a set, part or figure. As long as the image is loading, missing
 * or never arrives, the same placeholder sits below it (brick silhouette on
 * surfaceContainer): an empty white area in the gallery and detail looked like an
 * error in the app, and every spot had its own placeholder.
 */
@Composable
fun ProduktBild(
    model: Any?,
    imageLoader: ImageLoader,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Fit,
    fallbackSize: Dp = 40.dp,
    onState: ((AsyncImagePainter.State) -> Unit)? = null,
    /**
     * The whole area as the image background (tiles): product images sit on white, and with a
     * white background their edge blends into the surface instead of standing as a box in the
     * card. In the dark theme the area carries the theme's dark tone.
     */
    bildgrund: Boolean = false,
    /** Padding of the image to the edge of its area; the background reaches to the edge. */
    innerGap: Dp = 0.dp,
) {
    // Keyed on the target, not the request: a freshly built ImageRequest per
    // composition would otherwise reset the state constantly.
    val ziel = (model as? ImageRequest)?.data ?: model
    var geladen by remember(ziel) { mutableStateOf(false) }
    val dunkel = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    // In the dark theme a dark surface from the theme instead of muted white: a light-gray
    // area across the whole tile glared and looked the same in every dark theme.
    val grund = when {
        !bildgrund || !geladen -> Modifier
        dunkel -> Modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest)
        else -> Modifier.background(BILDGRUND)
    }
    Box(modifier.then(grund), contentAlignment = Alignment.Center) {
        if (!geladen) ImageFallback(Modifier.matchParentSize(), fallbackSize)
        if (model != null) {
            AsyncImage(
                model = model,
                imageLoader = imageLoader,
                contentDescription = contentDescription,
                modifier = Modifier.matchParentSize().padding(innerGap),
                contentScale = contentScale,
                // In the dark theme, the overlay only dims the pixels themselves; a rectangle on top
                // also darkened the area around a cut-out image.
                colorFilter = if (dunkel) DAMPING_DARK else null,
                onState = { st ->
                    geladen = st is AsyncImagePainter.State.Success
                    onState?.invoke(st)
                },
            )
        }
    }
}

/** The background of set images: white like their own background. */
private val BILDGRUND = Color.White

/**
 * Opacity of the overlay in the dark theme: at a fifth, white takes the glare out. At a
 * third, the product images looked gray and matte.
 */
private const val VEIL_DARK = 0.2f

/** The same overlay as a filter on the pixels, for images without a background of their own. */
private val DAMPING_DARK = ColorFilter.tint(Color.Black.copy(alpha = VEIL_DARK), BlendMode.SrcAtop)

/** The placeholder image alone — also for areas that have no address at all. */
@Composable
fun ImageFallback(modifier: Modifier = Modifier, groesse: Dp = 40.dp) {
    Box(
        modifier.background(MaterialTheme.colorScheme.surfaceContainer).testTag(IMAGE_FALLBACK),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            ImageVector.vectorResource(R.drawable.ic_stat_brick), null, Modifier.size(groesse),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f),
        )
    }
}
