package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
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
import ch.brickinventoryapp.ressourcen.R
import coil3.ImageLoader
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.util.appNumberLocale

/**
 * Bild bildschirmfuellend anzeigen, mit Zoom und Verschieben.
 * Ausführlich: docs/begruendungen/core-ui/ui/components/ZoomableImageDialog.kt.md#zoomableimagedialog
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
            if (zoomScale > 1.01f) {
                Text(
                    String.format(appNumberLocale(), "%.1f×", zoomScale),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = Abstaende.sehrGross)
                        .background(Color.Black.copy(alpha = 0.08f), shape = Formen.chip)
                        .padding(horizontal = Abstaende.mittel, vertical = Abstaende.winzig)
                )
            }
        }
    }
}

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
