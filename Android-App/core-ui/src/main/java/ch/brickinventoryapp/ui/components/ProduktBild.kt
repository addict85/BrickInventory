package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
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
 *
 * [modifier] gibt die Grösse vor; das Bild füllt sie. [onState] reicht Coils Zustand
 * weiter (Wiederholversuch, Rückfall auf die volle Auflösung).
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
) {
    // Am Ziel festgemacht, nicht an der Anfrage: Eine neu gebaute ImageRequest je
    // Zusammensetzung setzte den Zustand sonst ständig zurück.
    val ziel = (model as? ImageRequest)?.data ?: model
    var geladen by remember(ziel) { mutableStateOf(false) }
    Box(modifier, contentAlignment = Alignment.Center) {
        if (!geladen) BildErsatz(Modifier.matchParentSize(), ersatzGroesse)
        if (model != null) {
            AsyncImage(
                model = model,
                imageLoader = imageLoader,
                contentDescription = contentDescription,
                modifier = Modifier.matchParentSize(),
                contentScale = contentScale,
                onState = { st ->
                    geladen = st is AsyncImagePainter.State.Success
                    onState?.invoke(st)
                },
            )
        }
    }
}

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
