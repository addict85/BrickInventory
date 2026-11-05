package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ch.brickinventoryapp.ressourcen.R
import coil3.ImageLoader
import ch.brickinventoryapp.ui.theme.Abstaende
import kotlin.math.roundToInt

/**
 * Bild bildschirmfuellend anzeigen, mit Zoom und Verschieben.
 * Ausführlich: docs/begruendungen/core-ui/ui/components/ZoomableImageDialog.kt.md#zoomableimagedialog
 *
 * Zoomen geht auch ohne zwei Finger (WCAG 2.5.1): Doppeltipp und die Leiste unten mit
 * Minus, Faktor (zurück auf 100 %) und Plus, wie im PDF-Betrachter.
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
    fun setzeZoom(faktor: Float) {
        zoomScale = faktor.coerceIn(ZOOM_MIN, ZOOM_MAX)
        if (zoomScale <= ZOOM_MIN) zoomOffset = Offset.Zero
    }

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
                        val newScale = (zoomScale * zoom).coerceIn(ZOOM_MIN, ZOOM_MAX)
                        zoomOffset = if (newScale <= ZOOM_MIN) Offset.Zero else zoomOffset + pan
                        zoomScale = newScale
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = { setzeZoom(if (zoomScale > ZOOM_MIN + 0.01f) ZOOM_MIN else ZOOM_DOPPELTIPP) })
                }
        ) {
            ProduktBild(
                model = imageUrl,
                imageLoader = imageLoader,
                contentDescription = contentDescription,
                ersatzGroesse = 96.dp,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .align(Alignment.Center)
                    .padding(Abstaende.sehrGross)
                    .graphicsLayer(
                        scaleX = zoomScale, scaleY = zoomScale,
                        translationX = zoomOffset.x, translationY = zoomOffset.y
                    ),
                contentScale = ContentScale.Fit
            )
            SchliessenKnopf(onDismiss)
            BildZoomLeiste(zoomScale, ::setzeZoom, Modifier.align(Alignment.BottomCenter).padding(bottom = Abstaende.sehrGross))
        }
    }
}

/** Minus, Faktor und Plus; der Faktor ist zugleich „zurück auf 100 %“. */
@Composable
private fun BildZoomLeiste(zoom: Float, setzeZoom: (Float) -> Unit, modifier: Modifier) {
    Row(
        modifier.background(Color.Black.copy(alpha = 0.08f), shape = Formen.chip).padding(horizontal = Abstaende.winzig),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MitTooltip(stringResource(R.string.pdfview_zoom_out)) {
            val an = zoom > ZOOM_MIN + 0.01f
            IconButton(onClick = { setzeZoom(zoom / ZOOM_SCHRITT) }, enabled = an) {
                Icon(Icons.Default.ZoomOut, stringResource(R.string.pdfview_zoom_out), tint = Color.Black.copy(alpha = if (an) 1f else 0.38f))
            }
        }
        Box(
            Modifier.clickable(onClickLabel = stringResource(R.string.pdfview_zoom_reset), role = Role.Button) { setzeZoom(ZOOM_MIN) }
                .defaultMinSize(minWidth = 56.dp, minHeight = 48.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("${(zoom * 100).roundToInt()} %", color = Color.Black, style = MaterialTheme.typography.labelMedium)
        }
        MitTooltip(stringResource(R.string.pdfview_zoom_in)) {
            val an = zoom < ZOOM_MAX - 0.01f
            IconButton(onClick = { setzeZoom(zoom * ZOOM_SCHRITT) }, enabled = an) {
                Icon(Icons.Default.ZoomIn, stringResource(R.string.pdfview_zoom_in), tint = Color.Black.copy(alpha = if (an) 1f else 0.38f))
            }
        }
    }
}

private const val ZOOM_MIN = 1f
private const val ZOOM_MAX = 6f
private const val ZOOM_SCHRITT = 1.5f
private const val ZOOM_DOPPELTIPP = 2f

/** Oben rechts auf eigenem Kreis: Das Bild füllt den Schirm, der Knopf muss sich davon abheben. */
@Composable
private fun BoxScope.SchliessenKnopf(onDismiss: () -> Unit) {
    MitTooltip(stringResource(R.string.detail_close), Modifier.align(Alignment.TopEnd)) {
        IconButton(
            onClick = onDismiss,
            modifier = Modifier
                .padding(20.dp)
                .background(Color.Black.copy(alpha = 0.08f), shape = CircleShape)
        ) {
            Icon(Icons.Default.Close, stringResource(R.string.detail_close), tint = Color.Black)
        }
    }
}
