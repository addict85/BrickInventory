package ch.brickinventoryapp.finances.ui.screens

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.finances.ui.pdf.PdfSource
import ch.brickinventoryapp.finances.ui.pdf.PagesRenderer
import kotlin.math.roundToInt
import ch.brickinventoryapp.ui.components.WithTooltip

/**
 * Minus, factor, plus — at the bottom in the middle: the header already carries back,
 * print and download, and more buttons would leave the title little room; the
 * bottom is where the thumb is. Always visible, because here the bar is the reliable way to
 * zoom — the gesture can lose against scrolling. The factor stands there as a
 * number, not as a color.
 */
@Composable
internal fun ZoomBar(zoom: Float, setZoom: (Float) -> Unit, modifier: Modifier = Modifier) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            // Colors from the color scheme, not black with alpha: behind it lies
            // surfaceVariant, and in dark mode a black tile would be invisible. For
            // surface/onSurfaceVariant, Material3 guarantees the contrast in both modes.
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f), shape = Shapes.chip)
            .padding(horizontal = Spacing.tiny)
    ) {
        // Switched off at the limit. `enabled` is binding for the
        // keyboard and screen reader; the greying-out is only the accompaniment to that, not the
        // signal.
        WithTooltip(stringResource(R.string.pdfview_zoom_out)) {
            IconButton(
                onClick = { setZoom(zoom / PDF_ZOOM_STEP) },
                enabled = zoom > PDF_ZOOM_MIN + 0.01f
            ) {
                Icon(Icons.Default.ZoomOut, contentDescription = stringResource(R.string.pdfview_zoom_out))
            }
        }
        // The factor is at the same time the button "back to 100 %". defaultMinSize, so that it is
        // a 48-dp touch target like the buttons next to it.
        Box(
            modifier = Modifier
                // onClickLabel instead of just clickable: otherwise it would read out
                // „125 Prozent, Doppeltippen zum Aktivieren" — and what then
                // happens would stay open.
                .clickable(
                    onClickLabel = stringResource(R.string.pdfview_zoom_reset),
                    role = Role.Button,
                    onClick = { setZoom(PDF_ZOOM_MIN) }
                )
                .defaultMinSize(minWidth = 56.dp, minHeight = 48.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                "${(zoom * 100).roundToInt()} %",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelMedium
            )
        }
        WithTooltip(stringResource(R.string.pdfview_zoom_in)) {
            IconButton(
                onClick = { setZoom(zoom * PDF_ZOOM_STEP) },
                enabled = zoom < PDF_ZOOM_MAX - 0.01f
            ) {
                Icon(Icons.Default.ZoomIn, contentDescription = stringResource(R.string.pdfview_zoom_in))
            }
        }
    }
}

/**
 * What a zoom step needs from the gesture to the next measurement. Not a
 * Compose state: only the measuring reads it, it should trigger no redraw.
 */
internal class ZoomAnchor {
    /** Where in the viewport the next step takes hold; null = center. */
    var point: Offset? = null
    /** Center of the resting fingers in the viewport, continuously tracked. */
    var finger: Offset? = null
    /** At which zoom the list was last measured. */
    var measuredAt = 0f
    /** Waagerechtes Ziel, gesetzt beim Messen, eingeloest beim Platzieren. */
    var pendingX: Int? = null
}

@Composable
internal fun PdfPages(
    source: PdfSource, pageCount: Int, zoom: Float, anchor: ZoomAnchor, setZoom: (Float, Offset?) -> Unit,
    render: PagesRenderer,
) {
    val density = LocalDensity.current
    val horizontal = rememberScrollState()
    val vertical = rememberLazyListState()
    val gesture = rememberTransformableState { _, zoomChange, _, _ -> setZoom(zoom * zoomChange, anchor.finger) }

    // While two fingers are resting, the list does not scroll: the LazyColumn sees the
    // movement before the transformable and would claim a slightly vertical
    // two-finger gesture. This is counted in the initial pass, without claiming
    // anything.
    var twoFinger by remember { mutableStateOf(false) }

    // pointerInput(Unit) is not set up anew, so that a running gesture does not
    // break off; without rememberUpdatedState the double tap would see the first
    // `zoom` forever.
    val zoomNow by rememberUpdatedState(zoom)
    val setZoomNow by rememberUpdatedState(setZoom)

    BoxWithConstraints(Modifier.fillMaxSize()) {
        // The page width WITHOUT the margin that the list puts all around it — otherwise
        // the rendered bitmap would be too wide by twice spacing.small.
        val pagesWidth = (this.maxWidth - Spacing.small * 2) * zoom
        val renderWidthPx = with(density) {
            ((this@BoxWithConstraints.maxWidth - Spacing.small * 2).toPx() * renderLevel(zoom))
                .toInt().coerceAtLeast(1)
        }
        Box(
            Modifier
                .fillMaxSize()
                // The zoom holds fixed the point between the fingers. This is computed
                // here, in the measuring: only here are the layout of the old zoom and
                // the new zoom both available at once, and the new width already applies to
                // the scroll limit. An effect afterward would arrive one frame too late.
                .layout { measurable, limits ->
                    val f = if (anchor.measuredAt > 0f) zoom / anchor.measuredAt else 1f
                    anchor.measuredAt = zoom
                    if (f != 1f) {
                        val p = anchor.point ?: Offset(limits.maxWidth / 2f, limits.maxHeight / 2f)
                        anchor.point = null
                        val info = vertical.layoutInfo
                        zoomTargetY(
                            info.visibleItemsInfo.map {
                                PagesSituation(it.index, it.offset + info.beforeContentPadding, it.size)
                            },
                            p.y, f, info.beforeContentPadding, info.mainAxisItemSpacing,
                        )?.let { (index, offset) -> vertical.requestScrollToItem(index, offset) }
                        anchor.pendingX = zoomTargetX(horizontal.value, p.x, Spacing.small.toPx(), f)
                    }
                    val space = measurable.measure(limits)
                    layout(space.width, space.height) {
                        // Only now does horizontalScroll know the new width; before
                        // that it capped the target at the old one.
                        anchor.pendingX?.let { target ->
                            anchor.pendingX = null
                            horizontal.dispatchRawDelta((target - horizontal.value).toFloat())
                        }
                        space.place(0, 0)
                    }
                }
                // Order: transformable sits behind horizontalScroll and sees the movement
                // first. The other way around, horizontal scrolling could claim a two-finger gesture for
                // itself, and the zoom would never get its turn.
                .horizontalScroll(horizontal)
                .transformable(state = gesture, canPan = { false })
                .pointerInput(Unit) {
                    // Nur zaehlen, nie beanspruchen — siehe oben.
                    awaitPointerEventScope {
                        while (true) {
                            val e = awaitPointerEvent(PointerEventPass.Initial)
                            val on = e.changes.filter { it.pressed }
                            twoFinger = on.size >= 2
                            // This layer scrolls horizontally along; converted into the viewport.
                            anchor.finger = if (!twoFinger) null else Offset(
                                on.map { it.position.x }.average().toFloat() - horizontal.value,
                                on.map { it.position.y }.average().toFloat(),
                            )
                        }
                    }
                }
                .pointerInput(Unit) {
                    // Double tap: the reliable way with one finger. Tap
                    // recognizers do not claim drags (they abort at the
                    // threshold), so they do not fight with scrolling.
                    detectTapGestures(onDoubleTap = { p ->
                        setZoomNow(
                            if (zoomNow > PDF_ZOOM_MIN + 0.01f) PDF_ZOOM_MIN else PDF_ZOOM_DOUBLE_TAP,
                            Offset(p.x - horizontal.value, p.y),
                        )
                    })
                }
        ) {
            LazyColumn(
                state = vertical,
                userScrollEnabled = !twoFinger,
                modifier = Modifier
                    .width(pagesWidth + Spacing.small * 2)
                    .fillMaxHeight(),
                contentPadding = PaddingValues(Spacing.small),
                verticalArrangement = Arrangement.spacedBy(Spacing.small)
            ) {
                items((0 until pageCount).toList()) { index ->
                    PdfPage(source, index, renderWidthPx, render)
                }
            }
        }
    }
}

@Composable
private fun PdfPage(source: PdfSource, index: Int, renderWidthPx: Int, render: PagesRenderer) {
    var bitmap by remember(source, index) { mutableStateOf<Bitmap?>(null) }

    // remember without, LaunchedEffect with renderWidthPx: on a step change the
    // old bitmap stays up until the new one is there. A loading spinner would have a different height
    // and would lose the place in the instruction manual while zooming.
    LaunchedEffect(source, index, renderWidthPx) {
        val newValue = render(source, index, renderWidthPx)
        if (newValue != null) bitmap = newValue
    }

    val bmp = bitmap
    if (bmp != null) {
        Image(
            bitmap = bmp.asImageBitmap(),
            contentDescription = stringResource(R.string.pdfview_page, index + 1),
            modifier = Modifier
                .fillMaxWidth()
                .background(androidx.compose.ui.graphics.Color.White),
            contentScale = ContentScale.FillWidth
        )
    } else {
        Box(
            Modifier
                .fillMaxWidth()
                .height(360.dp),
            Alignment.Center
        ) {
            CircularProgressIndicator()
        }
    }
}
