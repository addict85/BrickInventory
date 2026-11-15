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
import ch.brickinventoryapp.ressourcen.R
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import coil3.request.ImageRequest

/** Testkennung des Ersatzbilds — Oberflächentests zählen damit leere Bildflächen. */
const val BILD_ERSATZ = "bild-ersatz"

/**
 * Jede Bildfläche eines Sets, Teils oder einer Figur. Solange das Bild lädt, fehlt
 * oder nicht kommt, steht darunter dasselbe Ersatzbild (Stein-Silhouette auf
 * surfaceContainer): Eine leere weisse Fläche sah in Galerie und Detail aus wie ein
 * Fehler der App, und jede Stelle hatte ihren eigenen Platzhalter.
 */
@Composable
fun ProduktBild(
    model: Any?,
    imageLoader: ImageLoader,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Fit,
    ersatzGroesse: Dp = 40.dp,
    onState: ((AsyncImagePainter.State) -> Unit)? = null,
    /**
     * Die ganze Fläche als Bildgrund (Kacheln): Produktbilder stehen auf Weiss, und mit
     * weissem Grund geht ihr Rand in der Fläche auf, statt als Kasten in der Karte
     * zu stehen. Im Dunkeln trägt die Fläche den dunklen Ton des Designs.
     */
    bildgrund: Boolean = false,
    /** Abstand des Bilds zum Rand seiner Fläche; der Grund reicht bis an den Rand. */
    innenAbstand: Dp = 0.dp,
) {
    // Am Ziel festgemacht, nicht an der Anfrage: Eine neu gebaute ImageRequest je
    // Zusammensetzung setzte den Zustand sonst ständig zurück.
    val ziel = (model as? ImageRequest)?.data ?: model
    var geladen by remember(ziel) { mutableStateOf(false) }
    val dunkel = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    // Im Dunkeln eine dunkle Fläche aus dem Design statt gedämpftem Weiss: Eine hellgraue
    // Fläche über die ganze Kachel blendete und sah in jedem dunklen Design gleich aus.
    val grund = when {
        !bildgrund || !geladen -> Modifier
        dunkel -> Modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest)
        else -> Modifier.background(BILDGRUND)
    }
    Box(modifier.then(grund), contentAlignment = Alignment.Center) {
        if (!geladen) BildErsatz(Modifier.matchParentSize(), ersatzGroesse)
        if (model != null) {
            AsyncImage(
                model = model,
                imageLoader = imageLoader,
                contentDescription = contentDescription,
                modifier = Modifier.matchParentSize().padding(innenAbstand),
                contentScale = contentScale,
                // Im Dunkeln dämpft der Schleier nur die Bildpunkte selbst; ein Rechteck darüber
                // dunkelte auch die Fläche um ein freigestelltes Bild.
                colorFilter = if (dunkel) DAEMPFUNG_DUNKEL else null,
                onState = { st ->
                    geladen = st is AsyncImagePainter.State.Success
                    onState?.invoke(st)
                },
            )
        }
    }
}

/** Der Grund der Setbilder: Weiss wie ihr eigener Hintergrund. */
private val BILDGRUND = Color.White

/**
 * Deckkraft des Schleiers im Dunkeln: Ein Fünftel nimmt Weiss das Blenden. Mit einem
 * Drittel wirkten die Produktbilder grau und matt.
 */
private const val SCHLEIER_DUNKEL = 0.2f

/** Derselbe Schleier als Filter auf den Bildpunkten, für Bilder ohne eigenen Grund. */
private val DAEMPFUNG_DUNKEL = ColorFilter.tint(Color.Black.copy(alpha = SCHLEIER_DUNKEL), BlendMode.SrcAtop)

/** Das Ersatzbild allein — auch für Flächen, die gar keine Adresse haben. */
@Composable
fun BildErsatz(modifier: Modifier = Modifier, groesse: Dp = 40.dp) {
    Box(
        modifier.background(MaterialTheme.colorScheme.surfaceContainer).testTag(BILD_ERSATZ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            ImageVector.vectorResource(R.drawable.ic_stat_brick), null, Modifier.size(groesse),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f),
        )
    }
}
