package ch.brickinventoryapp.finanzen.ui.screens

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
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.finanzen.ui.pdf.PdfQuelle
import ch.brickinventoryapp.finanzen.ui.pdf.SeitenRenderer
import kotlin.math.roundToInt
import ch.brickinventoryapp.ui.components.MitTooltip

/**
 * Minus, Faktor, Plus — unten in der Mitte: Die Kopfzeile trägt schon Zurück,
 * Drucken und Herunterladen, und mehr Knöpfe liessen dem Titel kaum Platz; unten
 * ist der Daumen. Immer sichtbar, weil die Leiste hier der verlässliche Weg zum
 * Zoomen ist — die Geste kann gegen das Rollen verlieren. Der Faktor steht als
 * Zahl da, nicht als Farbe.
 */
@Composable
internal fun ZoomLeiste(zoom: Float, setzeZoom: (Float) -> Unit, modifier: Modifier = Modifier) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            // Farben aus dem Farbschema, nicht Schwarz mit Alpha: Dahinter liegt
            // surfaceVariant, und im Dunkelmodus wäre ein schwarzes Plättchen unsichtbar. Für
            // surface/onSurfaceVariant sichert Material3 den Kontrast in beiden Modi zu.
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f), shape = Formen.chip)
            .padding(horizontal = Abstaende.winzig)
    ) {
        // Am Anschlag abgeschaltet. `enabled` ist fuer Tastatur und Screenreader
        // verbindlich; die Ausgrauung ist nur die Begleitung davon, nicht das
        // Signal.
        MitTooltip(stringResource(R.string.pdfview_zoom_out)) {
            IconButton(
                onClick = { setzeZoom(zoom / PDF_ZOOM_SCHRITT) },
                enabled = zoom > PDF_ZOOM_MIN + 0.01f
            ) {
                Icon(Icons.Default.ZoomOut, contentDescription = stringResource(R.string.pdfview_zoom_out))
            }
        }
        // Der Faktor ist zugleich der Knopf „zurück auf 100 %“. defaultMinSize, damit er
        // ein 48-dp-Berührungsziel ist wie die Knöpfe daneben.
        Box(
            modifier = Modifier
                // onClickLabel statt nur clickable: Vorgelesen wuerde sonst
                // „125 Prozent, Doppeltippen zum Aktivieren" — und was dann
                // passiert, bliebe offen.
                .clickable(
                    onClickLabel = stringResource(R.string.pdfview_zoom_reset),
                    role = Role.Button,
                    onClick = { setzeZoom(PDF_ZOOM_MIN) }
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
        MitTooltip(stringResource(R.string.pdfview_zoom_in)) {
            IconButton(
                onClick = { setzeZoom(zoom * PDF_ZOOM_SCHRITT) },
                enabled = zoom < PDF_ZOOM_MAX - 0.01f
            ) {
                Icon(Icons.Default.ZoomIn, contentDescription = stringResource(R.string.pdfview_zoom_in))
            }
        }
    }
}

/**
 * Was ein Zoomschritt von der Geste bis zur naechsten Messung braucht. Kein
 * Compose-Zustand: Nur das Messen liest es, neu zeichnen soll es nichts.
 */
internal class ZoomAnker {
    /** Wo im Sichtfeld der naechste Schritt ansetzt; null = Mitte. */
    var punkt: Offset? = null
    /** Mitte der aufliegenden Finger im Sichtfeld, laufend nachgefuehrt. */
    var finger: Offset? = null
    /** Bei welchem Zoom die Liste zuletzt gemessen wurde. */
    var gemessenBei = 0f
    /** Waagerechtes Ziel, gesetzt beim Messen, eingeloest beim Platzieren. */
    var ausstehendX: Int? = null
}

@Composable
internal fun PdfPages(
    quelle: PdfQuelle, pageCount: Int, zoom: Float, anker: ZoomAnker, setzeZoom: (Float, Offset?) -> Unit,
    rendere: SeitenRenderer,
) {
    val dichte = LocalDensity.current
    val waagrecht = rememberScrollState()
    val senkrecht = rememberLazyListState()
    val geste = rememberTransformableState { _, zoomChange, _, _ -> setzeZoom(zoom * zoomChange, anker.finger) }

    // Solange zwei Finger aufliegen, rollt die Liste nicht: Die LazyColumn sieht die
    // Bewegung vor dem transformable und gewönne eine leicht senkrechte
    // Zwei-Finger-Geste. Gezählt wird im Initial-Durchgang, ohne etwas zu
    // beanspruchen.
    var zweiFinger by remember { mutableStateOf(false) }

    // pointerInput(Unit) wird nicht neu aufgesetzt, damit eine laufende Geste nicht
    // abreisst; ohne rememberUpdatedState sähe der Doppeltipp für immer den ersten
    // `zoom`.
    val zoomJetzt by rememberUpdatedState(zoom)
    val setzeZoomJetzt by rememberUpdatedState(setzeZoom)

    BoxWithConstraints(Modifier.fillMaxSize()) {
        // Die Seitenbreite OHNE den Rand, den die Liste ringsum legt — sonst
        // waere die gerenderte Bitmap um zweimal Abstaende.klein zu breit.
        val seitenBreite = (this.maxWidth - Abstaende.klein * 2) * zoom
        val renderBreitePx = with(dichte) {
            ((this@BoxWithConstraints.maxWidth - Abstaende.klein * 2).toPx() * renderStufe(zoom))
                .toInt().coerceAtLeast(1)
        }
        Box(
            Modifier
                .fillMaxSize()
                // Der Zoom haelt den Punkt zwischen den Fingern fest. Gerechnet wird
                // hier, beim Messen: Nur hier liegen das Layout des alten Zooms und
                // der neue Zoom zugleich vor, und die neue Breite gilt schon fuer
                // die Rollgrenze. Ein Effekt danach kaeme ein Bild zu spaet.
                .layout { messbar, grenzen ->
                    val f = if (anker.gemessenBei > 0f) zoom / anker.gemessenBei else 1f
                    anker.gemessenBei = zoom
                    if (f != 1f) {
                        val p = anker.punkt ?: Offset(grenzen.maxWidth / 2f, grenzen.maxHeight / 2f)
                        anker.punkt = null
                        val info = senkrecht.layoutInfo
                        zoomZielY(
                            info.visibleItemsInfo.map {
                                SeitenLage(it.index, it.offset + info.beforeContentPadding, it.size)
                            },
                            p.y, f, info.beforeContentPadding, info.mainAxisItemSpacing,
                        )?.let { (index, versatz) -> senkrecht.requestScrollToItem(index, versatz) }
                        anker.ausstehendX = zoomZielX(waagrecht.value, p.x, Abstaende.klein.toPx(), f)
                    }
                    val platz = messbar.measure(grenzen)
                    layout(platz.width, platz.height) {
                        // Erst jetzt kennt horizontalScroll die neue Breite; vorher
                        // kappte es das Ziel an der alten.
                        anker.ausstehendX?.let { ziel ->
                            anker.ausstehendX = null
                            waagrecht.dispatchRawDelta((ziel - waagrecht.value).toFloat())
                        }
                        platz.place(0, 0)
                    }
                }
                // Reihenfolge: transformable steht hinter horizontalScroll und sieht die Bewegung
                // zuerst. Andersherum könnte das waagerechte Rollen eine Zwei-Finger-Geste für
                // sich beanspruchen, und der Zoom käme nie zum Zug.
                .horizontalScroll(waagrecht)
                .transformable(state = geste, canPan = { false })
                .pointerInput(Unit) {
                    // Nur zaehlen, nie beanspruchen — siehe oben.
                    awaitPointerEventScope {
                        while (true) {
                            val e = awaitPointerEvent(PointerEventPass.Initial)
                            val auf = e.changes.filter { it.pressed }
                            zweiFinger = auf.size >= 2
                            // Diese Ebene rollt waagerecht mit; ins Sichtfeld umgerechnet.
                            anker.finger = if (!zweiFinger) null else Offset(
                                auf.map { it.position.x }.average().toFloat() - waagrecht.value,
                                auf.map { it.position.y }.average().toFloat(),
                            )
                        }
                    }
                }
                .pointerInput(Unit) {
                    // Doppeltipp: der verlaessliche Weg mit einem Finger. Tipp-
                    // Erkenner beanspruchen keine Zuege (sie brechen beim
                    // Schwellwert ab), streiten also mit dem Rollen nicht.
                    detectTapGestures(onDoubleTap = { p ->
                        setzeZoomJetzt(
                            if (zoomJetzt > PDF_ZOOM_MIN + 0.01f) PDF_ZOOM_MIN else PDF_ZOOM_DOPPELTIPP,
                            Offset(p.x - waagrecht.value, p.y),
                        )
                    })
                }
        ) {
            LazyColumn(
                state = senkrecht,
                userScrollEnabled = !zweiFinger,
                modifier = Modifier
                    .width(seitenBreite + Abstaende.klein * 2)
                    .fillMaxHeight(),
                contentPadding = PaddingValues(Abstaende.klein),
                verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
            ) {
                items((0 until pageCount).toList()) { index ->
                    PdfPage(quelle, index, renderBreitePx, rendere)
                }
            }
        }
    }
}

@Composable
private fun PdfPage(quelle: PdfQuelle, index: Int, renderBreitePx: Int, rendere: SeitenRenderer) {
    var bitmap by remember(quelle, index) { mutableStateOf<Bitmap?>(null) }

    // remember ohne, LaunchedEffect mit renderBreitePx: Beim Stufenwechsel bleibt die
    // alte Bitmap stehen, bis die neue da ist. Ein Ladekreis hätte eine andere Höhe
    // und verlöre beim Zoomen die Stelle in der Anleitung.
    LaunchedEffect(quelle, index, renderBreitePx) {
        val neu = rendere(quelle, index, renderBreitePx)
        if (neu != null) bitmap = neu
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
