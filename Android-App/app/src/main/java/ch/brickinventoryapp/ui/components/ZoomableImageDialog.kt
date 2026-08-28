package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ch.brickinventoryapp.R
import coil.ImageLoader
import coil.compose.AsyncImage

/**
 * Bild bildschirmfuellend anzeigen, mit Zoom und Verschieben.
 *
 * -- Warum als eigene Komponente ---------------------------------------------
 * Diese Ansicht gab es nur im Set-Detail (SetDetailScreen). Fuer den Katalog
 * wurde derselbe Zoom gewuenscht -- kopieren haette rund fuenfzig Zeilen
 * Gesten-, Zustands- und Layoutlogik verdoppelt, und die beiden Fassungen
 * waeren beim naechsten Eingriff auseinandergelaufen. Genau dieses Muster ist
 * in diesem Projekt schon mehrfach schiefgegangen (zwei Fassungen von
 * closeAcqModal, zwei Kopien der Bild-Host-Allowlist).
 *
 * Beide Bildschirme benutzen deshalb diese eine Umsetzung.
 *
 * -- Verhalten ---------------------------------------------------------------
 * - Zwei-Finger-Geste skaliert zwischen 1x und 6x.
 * - Verschieben erst ab Skalierung > 1 -- sonst liesse sich das Bild aus dem
 *   Sichtfeld ziehen, ohne es zurueckholen zu koennen.
 * - Der Faktor wird unten eingeblendet, sobald er merklich ueber 1 liegt.
 *
 * @param imageUrl Bereits aufgeloeste Adresse (resolveFullUrl) -- diese
 *        Komponente baut selbst keine Adressen zusammen.
 * @param imageLoader Der injizierte Coil-Loader. ZWINGEND: Nur dieser haengt den
 *        Bearer-Token an (di/AppModule.kt). Coils Standard-Loader tut das nicht,
 *        und seit alle Bilder eine Anmeldung verlangen, liefert der Server
 *        darauf 401 -- die Flaeche bleibt leer, ohne Fehlermeldung.
 * @param contentDescription Fuer Screenreader; darf null sein.
 * @param onDismiss Wird beim Schliessen aufgerufen.
 */
@Composable
fun ZoomableImageDialog(
    imageUrl: String,
    contentDescription: String?,
    imageLoader: ImageLoader,
    onDismiss: () -> Unit
) {
    var zoomScale by remember { mutableStateOf(1f) }
    var zoomOffset by remember { mutableStateOf(Offset.Zero) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.White)
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        val newScale = (zoomScale * zoom).coerceIn(1f, 6f)
                        zoomOffset = if (newScale <= 1f) Offset.Zero else zoomOffset + pan
                        zoomScale = newScale
                    }
                }
        ) {
            AsyncImage(
                model = imageUrl,
                imageLoader = imageLoader,
                contentDescription = contentDescription,
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.Center)
                    .padding(24.dp)
                    .graphicsLayer(
                        scaleX = zoomScale, scaleY = zoomScale,
                        translationX = zoomOffset.x, translationY = zoomOffset.y
                    ),
                contentScale = ContentScale.Fit
            )
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(20.dp)
                    .background(Color.Black.copy(alpha = 0.08f), shape = CircleShape)
            ) {
                Icon(Icons.Default.Close, stringResource(R.string.detail_close), tint = Color.Black)
            }
            if (zoomScale > 1.01f) {
                Text(
                    "${"%.1f".format(zoomScale)}x",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 24.dp)
                        .background(Color.Black.copy(alpha = 0.08f), shape = Formen.chip)
                        .padding(horizontal = 12.dp, vertical = 4.dp)
                )
            }
        }
    }
}
