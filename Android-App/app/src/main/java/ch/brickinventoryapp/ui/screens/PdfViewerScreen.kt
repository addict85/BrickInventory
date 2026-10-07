package ch.brickinventoryapp.ui.screens

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentAdapter.LayoutResultCallback
import android.print.PrintDocumentAdapter.WriteResultCallback
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.view.WindowManager
import android.widget.Toast
import androidx.compose.material.icons.filled.Print
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.util.PdfSchritt
import ch.brickinventoryapp.util.pdfSchritt
import ch.brickinventoryapp.ui.theme.Formen
import kotlin.math.ceil
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * In-App PDF-Viewer.
 *
 * Große PDFs (>300MB) werden speicherschonend behandelt:
 *  - Download läuft streamend auf Platte (kein Voll-Puffer im RAM), mit Fortschritt.
 *  - Anzeige über den systemeigenen PdfRenderer, der Seiten EINZELN rendert; es
 *    ist immer nur die gerade sichtbare Seite als Bitmap im Speicher.
 * Der Download-Button KOPIERT die bereits geladene Datei über den MediaStore
 * in den öffentlichen Downloads-Ordner — er lädt sie nicht erneut. Ein zweiter
 * Abruf über den DownloadManager hätte keinen Bearer-Token dabei, und
 * Anleitungen verlangen auf dem Server eine Anmeldung.
 */
// ── Zoom ─────────────────────────────────────────────────────────────────────
//
// Der Faktor gilt auf die Grundgroesse, und die Grundgroesse ist „Seite fuellt
// die Breite". 1 ist deshalb der untere Anschlag: darunter gibt es nichts zu
// sehen, die Breite ist schon ganz da. Dieselbe Untergrenze hat der Bildzoom
// (ui/components/ZoomableImageDialog.kt) und der PDF-Betrachter der Weboberflaeche.
private const val PDF_ZOOM_MIN = 1f
private const val PDF_ZOOM_MAX = 5f
private const val PDF_ZOOM_SCHRITT = 1.25f      // ein Druck auf + bzw. −
private const val PDF_ZOOM_DOPPELTIPP = 2.5f    // Doppeltipp aus 1x heraus

/**
 * Obergrenze fuer eine Seiten-Bitmap, in Pixeln der Flaeche.
 *
 * ARGB_8888 heisst 4 Byte je Pixel, 8 Millionen Pixel sind also rund 32 MB.
 * Zum Vergleich: Die feste Breite von 1080 px, mit der dieser Betrachter bisher
 * gerendert hat, ergibt bei A4-Verhaeltnis rund 6,6 MB. Die LazyColumn haelt
 * die sichtbaren Seiten; bei starkem Zoom ist das eine bis zwei.
 *
 * Der Riegel wirkt auf die FLAECHE und nicht auf eine Seitenlaenge: Eine
 * querformatige Anleitungsseite hat dieselbe Pixelzahl wie eine hochformatige,
 * nur anders verteilt.
 *
 * Wird er erreicht, bleibt die Anzeige richtig und wird nur weicher — die
 * Bitmap ist dann kleiner als der Kasten und wird hochskaliert.
 */
internal const val PDF_BITMAP_MAX_PX = 8_000_000

/**
 * In welcher Aufloesung wird beim Faktor [zoom] gerendert — 1-, 2- oder 3-mal
 * die Behaelterbreite?
 *
 * STUFEN und nicht stufenlos, und das ist der Kern dieser Funktion: Beim Zoomen
 * aendert sich der Faktor mit jedem Bild der Geste. Haenge man die
 * Renderaufloesung unmittelbar daran, liefe waehrend einer einzigen
 * Zwei-Finger-Bewegung ein Dutzend PdfRenderer-Durchlaeufe an — auf einem
 * Mutex serialisiert, jeder einige zehn Millisekunden. Mit Stufen sind es
 * hoechstens zwei Wechsel auf dem ganzen Weg von 1x nach 5x.
 *
 * Dass es zwischen den Stufen weicher aussieht, ist gewollt: Dafuer ist die
 * Geste fluessig, und die scharfe Fassung kommt, sobald die Stufe wechselt.
 */
internal fun renderStufe(zoom: Float): Int = ceil(zoom).toInt().coerceIn(1, 3)

/**
 * Masse der Seiten-Bitmap: die gewuenschte Breite, auf [PDF_BITMAP_MAX_PX]
 * begrenzt.
 *
 * @param breitePx gewuenschte Breite in Pixeln
 * @param ratio Hoehe geteilt durch Breite der PDF-Seite
 * @return (Breite, Hoehe) in Pixeln, beide mindestens 1
 *
 * Begrenzt wird die FLAECHE, weil sie den Speicher bestimmt, und mit der WURZEL,
 * weil beide Seitenlaengen gleichmaessig schrumpfen muessen — nur die Breite zu
 * kappen wuerde das Seitenverhaeltnis verlieren und die Seite verzerren.
 *
 * Eigene Funktion statt drei Zeilen in renderPdfPage(): So ist die Rechnung
 * pruefbar, ohne einen PdfRenderer und damit ein Geraet zu brauchen
 * (PdfZoomTest).
 */
internal fun bitmapMasse(breitePx: Int, ratio: Float): Pair<Int, Int> {
    var w = breitePx.coerceAtLeast(1)
    val flaeche = w.toFloat() * (w * ratio)
    if (flaeche > PDF_BITMAP_MAX_PX) w = (w * sqrt(PDF_BITMAP_MAX_PX / flaeche)).toInt()
    w = w.coerceAtLeast(1)
    return w to (w * ratio).toInt().coerceAtLeast(1)
}

private sealed class PdfLoadState {
    data class Downloading(val pct: Int, val bytes: Long, val total: Long) : PdfLoadState()
    object Rendering : PdfLoadState()
    data class Ready(val file: File, val pageCount: Int) : PdfLoadState()
    data class Error(val message: String) : PdfLoadState()
}

// PdfRenderer ist nicht thread-safe und öffnet nur eine Seite gleichzeitig →
// alle Render-Zugriffe serialisieren.
private val pdfRenderMutex = Mutex()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfViewerScreen(
    pdfUrl: String,
    title: String,
    httpClient: OkHttpClient,
    onBack: () -> Unit
) {
    val ctx = LocalContext.current
    // `stringResource` statt `ctx.getString` im Rueckruf: Lint meldet
    // LocalContextGetResourceValueCall (Stufe ERROR), weil ein aus
    // LocalContext.current gegriffener Context nach einem Wechsel der
    // Konfiguration — Sprache, Dunkelmodus, Drehung — veraltete Werte liefern
    // kann. Hier geholt, in der Komposition, wo Compose bei einer Aenderung neu
    // auswertet.
    val ladefehlerText = stringResource(R.string.pdfview_download_failed)
    val unbekannterFehlerText = stringResource(R.string.pdfview_unknown_error)
    var state by remember(pdfUrl) { mutableStateOf<PdfLoadState>(PdfLoadState.Downloading(0, 0, 0)) }
    // Der Zoom gehoert hierher und nicht in PdfPages: Die Knoepfe sitzen in der
    // Kopfzeile, die Geste in der Liste, und der Faktor wird unten angezeigt —
    // drei Stellen, eine Wahrheit. Zurueck auf 1x bei einem anderen PDF.
    var zoom by remember(pdfUrl) { mutableFloatStateOf(PDF_ZOOM_MIN) }
    val setzeZoom = { neu: Float -> zoom = neu.coerceIn(PDF_ZOOM_MIN, PDF_ZOOM_MAX) }

    // Bildschirm WÄHREND DES LADENS anlassen: Geht das Display aus, trennt Android
    // (je nach Gerät/WLAN-Sleep) kurz das Netzwerk, was zu DNS-Fehlern führt
    // ("Unable to resolve host … No address associated with hostname"). Nach dem
    // Laden wird das Flag wieder freigegeben (Akku schonen).
    val isLoading = state is PdfLoadState.Downloading || state is PdfLoadState.Rendering
    DisposableEffect(isLoading) {
        val window = ctx.findActivity()?.window
        if (isLoading) window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }

    LaunchedEffect(pdfUrl) {
        state = PdfLoadState.Downloading(0, 0, 0)
        // WLAN wachhalten: Wird der Bildschirm schwarz (auch manuelle Sperre), kann
        // Android sonst das WLAN schlafen legen → DNS-/Verbindungsabbruch.
        @Suppress("DEPRECATION")
        val wifiLock = (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)
            ?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "brickinv:pdf")
        try {
            try { wifiLock?.acquire() } catch (_: Exception) {}
            val cacheFile = File(ctx.cacheDir, "pdfview_${pdfUrl.hashCode()}.pdf")
            val (file, pageCount) = ladeUndZaehle(
                pdfUrl, cacheFile, httpClient,
                ladefehlerText,
                aufraeumen = { prunePdfCache(ctx.cacheDir, keep = cacheFile) },
            ) { state = it }
            state = PdfLoadState.Ready(file, pageCount)
        } catch (e: Exception) {
            state = PdfLoadState.Error(e.message ?: unbekannterFehlerText)
        } finally {
            try { if (wifiLock?.isHeld == true) wifiLock.release() } catch (_: Exception) {}
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title.ifBlank { "PDF" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    // Beide Knöpfe erst im Zustand Ready: Sie arbeiten auf der
                    // geladenen Datei. Der Herunterladen-Knopf stand vorher
                    // ausserhalb dieser Bedingung und startete einen eigenen,
                    // nicht authentifizierten Download (siehe savePdfToDownloads).
                    val s = state
                    if (s is PdfLoadState.Ready) {
                        IconButton(onClick = { printPdf(ctx, s.file, title) }) {
                            Icon(Icons.Default.Print, contentDescription = stringResource(R.string.pdfview_print))
                        }
                        IconButton(onClick = { savePdfToDownloads(ctx, s.file, title) }) {
                            Icon(Icons.Default.Download, contentDescription = stringResource(R.string.pdfview_download))
                        }
                    }
                }
            )
        }
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.surfaceVariant)
        ) {
            when (val s = state) {
                is PdfLoadState.Downloading -> DownloadProgress(s)
                is PdfLoadState.Rendering -> CenteredLoading(stringResource(R.string.pdfview_rendering))
                is PdfLoadState.Ready -> PdfPages(s.file, s.pageCount, zoom, setzeZoom)
                is PdfLoadState.Error -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text(
                        stringResource(R.string.pdfview_load_failed, s.message),
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(Abstaende.sehrGross)
                    )
                }
            }
            if (state is PdfLoadState.Ready) {
                ZoomLeiste(
                    zoom = zoom,
                    setzeZoom = setzeZoom,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = Abstaende.gross)
                )
            }
        }
    }
}

@Composable
private fun DownloadProgress(s: PdfLoadState.Downloading) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
            modifier = Modifier.padding(Abstaende.sehrGross)
        ) {
            if (s.total > 0) {
                CircularProgressIndicator(progress = { s.pct / 100f })
                Text(stringResource(R.string.pdfview_loading_pct, s.pct))
                Text(
                    "${formatMb(s.bytes)} / ${formatMb(s.total)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                CircularProgressIndicator()
                Text(stringResource(R.string.pdfview_loading_bytes, formatMb(s.bytes)))
            }
        }
    }
}

@Composable
private fun CenteredLoading(text: String) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)
        ) {
            CircularProgressIndicator()
            Text(text)
        }
    }
}

/**
 * Minus, Faktor, Plus — unten in der Mitte.
 *
 * ── Warum unten und nicht in der Kopfzeile ──────────────────────────────────
 *
 * Dort waere es der naheliegende Platz, aber die Kopfzeile traegt schon Zurueck,
 * Drucken und Herunterladen. Mit zwei weiteren Knoepfen blieben auf einem
 * Telefon rund 120 dp fuer den Titel, und der Titel ist der Name der Anleitung
 * — genau das, was man beim Blaettern durch mehrere Anleitungen lesen will.
 *
 * Unten kommt dazu, dass der Daumen dort ist, und dass der Faktor beim
 * Bedienelement steht, das ihn aendert, statt am anderen Ende des Bildschirms.
 *
 * ── Warum immer sichtbar und nicht erst ab 1x ───────────────────────────────
 *
 * Der Bildzoom (ZoomableImageDialog.kt) blendet seinen Faktor erst ein, wenn er
 * ueber 1 liegt — dort ist das richtig, denn die Zwei-Finger-Geste ist der
 * einzige Weg und jeder kennt sie. Hier ist die Leiste AUCH der Weg, auf dem
 * gezoomt wird, und zwar der verlaessliche: Die Geste kann im Streit mit dem
 * Rollen der Liste unterliegen (siehe PdfPages). Ein Bedienelement, das erst
 * erscheint, nachdem man das getan hat, wofuer man es braucht, ist keines.
 *
 * Der Faktor ist eine ZAHL, kein Balken und keine Farbe: Man muss ablesen
 * koennen, wo man ist, und zwar unabhaengig davon, welche Farben man
 * unterscheidet.
 */
@Composable
private fun ZoomLeiste(zoom: Float, setzeZoom: (Float) -> Unit, modifier: Modifier = Modifier) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            // Farben aus dem Farbschema, nicht Schwarz mit Alpha: Der Hintergrund
            // dahinter ist surfaceVariant, und im Dunkelmodus waere ein
            // schwarzes Plaettchen darauf unsichtbar. surface/onSurfaceVariant
            // ist das Paar, fuer das Material3 den Kontrast in BEIDEN Modi
            // zusichert.
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f), shape = Formen.chip)
            .padding(horizontal = Abstaende.winzig)
    ) {
        // Am Anschlag abgeschaltet. `enabled` ist fuer Tastatur und Screenreader
        // verbindlich; die Ausgrauung ist nur die Begleitung davon, nicht das
        // Signal.
        IconButton(
            onClick = { setzeZoom(zoom / PDF_ZOOM_SCHRITT) },
            enabled = zoom > PDF_ZOOM_MIN + 0.01f
        ) {
            Icon(Icons.Default.ZoomOut, contentDescription = stringResource(R.string.pdfview_zoom_out))
        }
        Text(
            "${(zoom * 100).roundToInt()} %",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier
                // onClickLabel statt nur clickable: Vorgelesen wuerde sonst
                // „125 Prozent, Doppeltippen zum Aktivieren" — und was dann
                // passiert, bliebe offen.
                .clickable(
                    onClickLabel = stringResource(R.string.pdfview_zoom_reset),
                    onClick = { setzeZoom(PDF_ZOOM_MIN) }
                )
                .padding(horizontal = Abstaende.klein, vertical = Abstaende.winzig)
        )
        IconButton(
            onClick = { setzeZoom(zoom * PDF_ZOOM_SCHRITT) },
            enabled = zoom < PDF_ZOOM_MAX - 0.01f
        ) {
            Icon(Icons.Default.ZoomIn, contentDescription = stringResource(R.string.pdfview_zoom_in))
        }
    }
}

/**
 * Die Seiten, zoombar.
 *
 * ── Warum der Zoom die BREITE aendert und nicht einen graphicsLayer ─────────
 *
 * Der naheliegende Weg waere der aus ZoomableImageDialog.kt: scaleX/scaleY in
 * einem graphicsLayer, dazu ein Verschiebe-Offset. Fuer ein einzelnes Bild ohne
 * Rollbalken ist das richtig. Hier nicht, aus drei Gruenden:
 *
 *  1. Die Bitmaps sind in einer festen Aufloesung gerendert. Ein graphicsLayer
 *     streckt sie nur — bei 4x waere eine Teilenummer unleserlich. Die
 *     Seitenbreite als Mass zu nehmen heisst dagegen, dass PdfPage genau in der
 *     Groesse rendert, in der die Seite steht.
 *  2. Ein graphicsLayer auf der LazyColumn skaliert auch deren Sichtfeld: Ein
 *     Zug von 100 px rollt dann 100 * Faktor Pixel weit. Das fuehlt sich bei 4x
 *     wie ein Rutsch an.
 *  3. Der Verschiebe-Offset muesste gegen die Inhaltsgroesse begrenzt werden,
 *     und die kennt niemand, solange die Liste faul laedt. ZoomableImageDialog
 *     begrenzt ihn NICHT — dort kann man das Bild bei 6x aus dem Sichtfeld
 *     ziehen. Bei einer 80-seitigen Anleitung waere das kein Schoenheitsfehler.
 *
 * Mit der Breite als Mass macht ein echtes horizontalScroll das Verschieben:
 * mit Schwung, mit Anschlag, nicht verlierbar.
 *
 * ── Warum sich die Geste nicht mit dem Rollen schlaegt ──────────────────────
 *
 * GELESEN in der Quelle von foundation (gestures/Transformable.kt,
 * gestures/DragGestureDetector.kt), nicht vermutet:
 *
 *  - `transformable(state, canPan = { false })`: In detectZoom() kommt der
 *    Schwellwert nur ueber zoomMotion, rotationMotion oder
 *    `panMotion > touchSlop && canPan(...)`. Mit canPan = false faellt der
 *    dritte Weg weg, und mit EINEM Finger sind zoomChange 1 und rotationChange
 *    0 — ein Einfinger-Zug wird also nie beansprucht. Genau fuer diesen Zweck
 *    gibt es die Ueberladung; ihr eigener Kommentar nennt als Beispiel
 *    „TransformableSampleInsideScroll".
 *  - detectZoom() bricht ausserdem von selbst ab, sobald ein anderer die
 *    Bewegung beansprucht (`event.changes.fastAny { it.isConsumed }` →
 *    TransformStopped). Unterliegt die Geste also doch, rollt die Liste — und
 *    es passiert nicht beides.
 *  - Senkrecht und waagerecht vertragen sich: TouchSlopDetector rechnet bei
 *    gesetzter Orientierung nur `finalChange.mainAxis().absoluteValue`. Ein
 *    waagerechter Zug ueberschreitet den senkrechten Schwellwert nie, also
 *    beansprucht die LazyColumn ihn nicht, und das horizontalScroll bekommt ihn.
 *
 * NICHT geprueft, weil es dafuer ein Geraet braucht: Bei einer Zwei-Finger-Geste,
 * deren Finger sich fast senkrecht voneinander entfernen, kann die LazyColumn
 * schneller am Schwellwert sein und die Geste gewinnen. Dann rollt die Liste
 * statt zu zoomen — unschoen, aber nichts geht kaputt. Dagegen stehen der
 * Doppeltipp und die beiden Knoepfe in der Kopfzeile.
 */
@Composable
private fun PdfPages(file: File, pageCount: Int, zoom: Float, setzeZoom: (Float) -> Unit) {
    val dichte = LocalDensity.current
    val waagrecht = rememberScrollState()
    val geste = rememberTransformableState { zoomChange, _, _ -> setzeZoom(zoom * zoomChange) }

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
                // Reihenfolge: transformable steht HINTER horizontalScroll und
                // ist damit das tiefere Glied — es sieht die Bewegung zuerst.
                // Andersherum koennte das waagerechte Rollen eine Zwei-Finger-
                // Geste fuer sich beanspruchen, deren Finger auseinandergehen,
                // und der Zoom kaeme nie zum Zug.
                .horizontalScroll(waagrecht)
                .transformable(state = geste, canPan = { false })
                .pointerInput(Unit) {
                    // Doppeltipp: der verlaessliche Weg mit einem Finger. Tipp-
                    // Erkenner beanspruchen keine Zuege (sie brechen beim
                    // Schwellwert ab), streiten also mit dem Rollen nicht.
                    detectTapGestures(onDoubleTap = {
                        setzeZoom(if (zoom > PDF_ZOOM_MIN + 0.01f) PDF_ZOOM_MIN else PDF_ZOOM_DOPPELTIPP)
                    })
                }
        ) {
            LazyColumn(
                modifier = Modifier
                    .width(seitenBreite + Abstaende.klein * 2)
                    .fillMaxHeight(),
                contentPadding = PaddingValues(Abstaende.klein),
                verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
            ) {
                items((0 until pageCount).toList()) { index ->
                    PdfPage(file, index, renderBreitePx)
                }
            }
        }
    }
}

@Composable
private fun PdfPage(file: File, index: Int, renderBreitePx: Int) {
    var bitmap by remember(file, index) { mutableStateOf<Bitmap?>(null) }

    // `remember(file, index)` ohne renderBreitePx, LaunchedEffect MIT: Beim
    // Wechsel der Renderstufe bleibt die alte Bitmap stehen, bis die neue da
    // ist. Wuerde der Zustand mit zurueckgesetzt, blitzte bei jedem
    // Stufenwechsel auf allen sichtbaren Seiten der Ladekreis auf — und das
    // waere nicht nur haesslich, sondern bei einem Zoom mitten in einer langen
    // Anleitung der Verlust der Stelle, weil leere Seiten eine andere Hoehe
    // haben als gerenderte.
    LaunchedEffect(file, index, renderBreitePx) {
        val neu = withContext(Dispatchers.IO) { renderPdfPage(file, index, renderBreitePx) }
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

private suspend fun renderPdfPage(file: File, index: Int, targetWidthPx: Int): Bitmap? =
    pdfRenderMutex.withLock {
        var pfd: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        try {
            pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            renderer = PdfRenderer(pfd)
            if (index >= renderer.pageCount) return@withLock null
            val page = renderer.openPage(index)
            val ratio = page.height.toFloat() / page.width.toFloat().coerceAtLeast(1f)
            val (w, h) = bitmapMasse(targetWidthPx, ratio)
            // KTX-Form; ARGB_8888 ist dort die Vorbelegung (gelesen in
            // androidx.core.graphics.Bitmap.kt).
            val bmp = createBitmap(w, h)
            bmp.eraseColor(AndroidColor.WHITE)
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            page.close()
            bmp
        } catch (e: Exception) {
            null
        } finally {
            renderer?.close()
            pfd?.close()
        }
    }

/**
 * Robuster Download großer PDFs mit OkHttp:
 *  - callTimeout(0): kein Gesamt-Timeout (300MB dürfen lange laden),
 *  - retryOnConnectionFailure,
 *  - RESUME: bricht die Verbindung ab ("Software caused connection abort" o.ä.),
 *    wird der Download per Range-Request an der Abbruchstelle fortgesetzt statt
 *    von vorne — bis zu maxAttempts Versuche.
 */
/**
 * Laden und Seiten zaehlen — mit EINEM Selbstheilungsversuch.
 *
 * ── Warum der zweite Versuch ────────────────────────────────────────────────
 *
 * Seit der Download in `<name>.part` schreibt (util/PdfCache.kt), heisst eine
 * Datei ohne Endung `.part` „vollstaendig". Auf Geraeten, die die App vorher
 * schon hatten, stimmt das nicht unbedingt: Die alte Fassung schrieb direkt in
 * `<name>`, und ein dort abgebrochener Download hinterliess eine abgeschnittene
 * Datei unter dem fertigen Namen. Die wuerde jetzt als fertig gelten und beim
 * Oeffnen an PdfRenderer scheitern — mit einer Meldung, die nach einem
 * kaputten Server aussieht und keiner ist.
 *
 * Deshalb: Scheitert das Aufbereiten, wird der Zwischenspeicher fuer genau
 * diese Anleitung weggeworfen und EINMAL frisch geladen. Klappt es dann wieder
 * nicht, liegt es nicht am Zwischenspeicher, und der Fehler geht durch.
 *
 * Genau einmal, nicht in einer Schleife: Eine Anleitung, die der Renderer
 * nicht lesen kann, wird das auch beim dritten Mal nicht — dann waere es eine
 * Endlosschleife ueber 300 MB.
 */
private suspend fun ladeUndZaehle(
    url: String,
    cacheFile: File,
    httpClient: OkHttpClient,
    fehlerText: String,
    aufraeumen: () -> Unit,
    onZustand: (PdfLoadState) -> Unit,
): Pair<File, Int> {
    var versuch = 0
    while (true) {
        versuch++
        withContext(Dispatchers.IO) {
            aufraeumen()
            downloadPdfWithResume(url, cacheFile, httpClient, fehlerText) { geladen, gesamt ->
                val pct = if (gesamt > 0) (geladen * 100 / gesamt).toInt() else 0
                onZustand(PdfLoadState.Downloading(pct, geladen, if (gesamt > 0) gesamt else 0L))
            }
        }
        onZustand(PdfLoadState.Rendering)
        try {
            val anzahl = withContext(Dispatchers.IO) {
                val pfd = ParcelFileDescriptor.open(cacheFile, ParcelFileDescriptor.MODE_READ_ONLY)
                val renderer = PdfRenderer(pfd)
                val count = renderer.pageCount
                renderer.close()
                pfd.close()
                count
            }
            return cacheFile to anzahl
        } catch (e: Exception) {
            if (versuch >= 2) throw e
            withContext(Dispatchers.IO) {
                cacheFile.delete()
                File(cacheFile.path + ".part").delete()
            }
            onZustand(PdfLoadState.Downloading(0, 0, 0))
        }
    }
}

/**
 * Hält den PDF-Ansichts-Cache unter [PDF_CACHE_BUDGET_BYTES].
 *
 * Angesehene Anleitungen bleiben absichtlich liegen (erneutes Öffnen ohne
 * Neudownload, und der Resume-Mechanismus setzt auf einer Teildatei auf) —
 * nur gab es dafür bisher keine Obergrenze. Bei Anleitungen von bis zu
 * 300 MB liegen nach ein paar Sets mehrere GB im Cache, bis Android bei
 * Speichernot selbst räumt.
 *
 * Älteste zuerst, und [keep] wird nie gelöscht: Das ist die gerade
 * angeforderte Datei, deren Teil-Download sonst verloren ginge.
 */
private fun prunePdfCache(cacheDir: File, keep: File) {
    try {
        // `.part` MIT gezaehlt: Ein abgebrochener 300-MB-Download belegt
        // denselben Platz wie ein fertiger. Vorher endete der Filter auf
        // ".pdf" und uebersah die Teildateien — sie waren damit vom Budget
        // ausgenommen und wurden nie geraeumt.
        val files = cacheDir.listFiles { f ->
            f.isFile && f.name.startsWith("pdfview_") &&
                (f.name.endsWith(".pdf") || f.name.endsWith(".pdf.part"))
        }?.sortedByDescending { it.lastModified() } ?: return

        // Die gerade angeforderte Anleitung hat ZWEI Namen (fertig und
        // Teildatei); geschont werden beide, sonst raeumt dieser Lauf den
        // Download weg, den er gleich fortsetzen soll.
        val geschont = setOf(keep.absolutePath, keep.absolutePath + ".part")
        var used = 0L
        for (f in files) {
            // Die aktuell angeforderte Datei zählt zum Budget, wird aber nie gelöscht
            if (f.absolutePath in geschont) { used += f.length(); continue }
            used += f.length()
            if (used > PDF_CACHE_BUDGET_BYTES) f.delete()
        }
    } catch (_: Exception) { /* Best effort — Aufräumen darf den Download nie verhindern */ }
}

private const val PDF_CACHE_BUDGET_BYTES = 500L * 1024 * 1024

private suspend fun downloadPdfWithResume(
    url: String,
    dest: File,
    baseClient: OkHttpClient,
    /**
     * Meldung, wenn alle Versuche gescheitert sind und die Ursache selbst
     * keine trägt. Kommt als Parameter herein, damit diese Funktion ohne
     * Context und ohne Ressourcenzugriff bleibt — sie läuft auf dem
     * IO-Dispatcher und ist die einzige hier, die reine Netzarbeit macht.
     */
    fehlerText: String,
    onProgress: (downloaded: Long, total: Long) -> Unit
) {
    // Vom geteilten api-Client ABGELEITET statt eigenständig gebaut:
    // newBuilder() übernimmt Interceptors, Thread- und Connection-Pool.
    // Damit gelten Bearer-Token, Klartext-Verbot und die 401-Meldung
    // (SessionExpiredSignal) automatisch — die frühere, handgepflegte
    // NetworkPolicy-Prüfung an dieser Stelle entfällt, weil der
    // Interceptor sie bereits durchsetzt. Nur die Timeouts weichen ab:
    // callTimeout(0), weil 300-MB-Anleitungen lange laden dürfen.
    val client = baseClient.newBuilder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    // Der laufende Download schreibt in `<name>.part`; erst der Abschluss
    // benennt um. Warum das der Kern des Fehlers war, steht in
    // util/PdfCache.kt — kurz: Ohne diese Trennung ist eine FERTIGE Datei von
    // einem abgebrochenen Download nicht zu unterscheiden, und der Viewer
    // fragte nach einem Bereich hinter dem Dateiende.
    val teil = File(dest.path + ".part")

    val maxAttempts = 8
    var lastError: Exception? = null
    for (attempt in 1..maxAttempts) {
        when (val schritt = pdfSchritt(
            fertigeGroesse = if (dest.exists()) dest.length() else 0L,
            teilGroesse    = if (teil.exists()) teil.length() else 0L,
        )) {
            is PdfSchritt.Fertig -> {
                // Schon vollstaendig da: kein Netz, kein Warten. Der Fortschritt
                // wird trotzdem gemeldet, damit die Anzeige nicht bei 0 % stehen
                // bleibt, bevor sie auf „wird aufbereitet" springt.
                val len = dest.length()
                onProgress(len, len)
                return
            }
            is PdfSchritt.Holen -> {
                val ab = schritt.ab
                val reqBuilder = Request.Builder().url(url)
                if (ab > 0) reqBuilder.header("Range", "bytes=$ab-")
                try {
                    client.newCall(reqBuilder.build()).execute().use { resp ->
                        if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
                        // Server unterstützt Range → 206; ignoriert Range → 200 (neu starten).
                        val resuming = resp.code == 206 && ab > 0
                        if (ab > 0 && !resuming) teil.delete()
                        // Kein `?:`: `resp.body` ist seit OkHttp 5 nicht
                        // nullbar. Damit war nicht nur der Elvis-Operator
                        // ueberfluessig, sondern auch der Parameter `leerText`
                        // und die Zeichenkette dahinter — eine Meldung fuer
                        // einen Fall, den es nicht mehr geben kann.
                        val body = resp.body
                        val total: Long = if (resuming) {
                            resp.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
                                ?: (ab + body.contentLength())
                        } else {
                            body.contentLength()
                        }
                        var downloaded = if (resuming) ab else 0L
                        RandomAccessFile(teil, "rw").use { raf ->
                            if (resuming) raf.seek(ab) else raf.setLength(0)
                            body.byteStream().use { input ->
                                val buf = ByteArray(64 * 1024)
                                var lastPct = -1
                                var lastEmit = 0L
                                var read = input.read(buf)
                                while (read != -1) {
                                    raf.write(buf, 0, read)
                                    downloaded += read
                                    val now = System.currentTimeMillis()
                                    val pct = if (total > 0) (downloaded * 100 / total).toInt() else -1
                                    if (pct != lastPct || now - lastEmit > 300) {
                                        lastPct = pct; lastEmit = now
                                        onProgress(downloaded, total)
                                    }
                                    read = input.read(buf)
                                }
                            }
                        }
                        onProgress(downloaded, total)
                    }
                    // Erst JETZT heisst die Datei wie die fertige. Schlaegt das
                    // Umbenennen fehl (seltene Dateisystem-Eigenheit), wird
                    // kopiert statt aufgegeben — sonst laedt der naechste
                    // Aufruf alles noch einmal.
                    if (!teil.renameTo(dest)) {
                        teil.copyTo(dest, overwrite = true)
                        teil.delete()
                    }
                    return // Erfolg
                } catch (e: Exception) {
                    lastError = e
                    if (attempt < maxAttempts) delay((1000L * attempt).coerceAtMost(4000L)) // Pause, dann Resume
                }
            }
        }
    }
    throw lastError ?: IOException(fehlerText)
}

// Druckt die bereits geladene PDF-Datei über das System-Druckframework.
private fun printPdf(ctx: Context, file: File, title: String) {
    try {
        val printManager = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
        val jobName = title.ifBlank { ctx.getString(R.string.pdfview_default_name) }
        val adapter = object : PrintDocumentAdapter() {
            override fun onLayout(
                oldAttributes: PrintAttributes?,
                newAttributes: PrintAttributes?,
                cancellationSignal: CancellationSignal?,
                callback: LayoutResultCallback?,
                extras: Bundle?
            ) {
                if (cancellationSignal?.isCanceled == true) {
                    callback?.onLayoutCancelled()
                    return
                }
                val info = PrintDocumentInfo.Builder("$jobName.pdf")
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .build()
                callback?.onLayoutFinished(info, oldAttributes != newAttributes)
            }

            override fun onWrite(
                pages: Array<out PageRange>?,
                destination: ParcelFileDescriptor,
                cancellationSignal: CancellationSignal?,
                callback: WriteResultCallback?
            ) {
                try {
                    file.inputStream().use { input ->
                        FileOutputStream(destination.fileDescriptor).use { output ->
                            input.copyTo(output)
                        }
                    }
                    if (cancellationSignal?.isCanceled == true) {
                        callback?.onWriteCancelled()
                    } else {
                        callback?.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
                    }
                } catch (e: Exception) {
                    callback?.onWriteFailed(e.message)
                }
            }
        }
        printManager.print(jobName, adapter, PrintAttributes.Builder().build())
    } catch (e: Exception) {
        Toast.makeText(ctx, ctx.getString(R.string.pdfview_print_failed, e.message ?: ""), Toast.LENGTH_LONG).show()
    }
}

/**
 * Die bereits geladene PDF-Datei in den Download-Ordner kopieren.
 *
 * ── Warum nicht mehr über den DownloadManager ───────────────────────────────
 * Vorher lief das über `DownloadManager.Request(Uri.parse(url))` — also ein
 * ZWEITER Download derselben Datei, ausgeführt vom System-Dienst statt von
 * unserem OkHttp-Client. Der Dienst kennt unseren Bearer-Token nicht, und
 * Anleitungen verlangen auf dem Server eine Anmeldung (/data/instructions/…).
 * Ergebnis: eine 401-Antwort, die als "anleitung.pdf" im Download-Ordner
 * landete — eine Datei, die aussieht wie ein PDF und keines ist. Der Fehler
 * fiel nicht auf, weil der DownloadManager den Statuscode nicht prüft und die
 * Erfolgsmeldung trotzdem erscheint.
 *
 * Die Datei liegt zu diesem Zeitpunkt ohnehin schon vollständig im Cache — sie
 * wurde für die Anzeige geladen, über den authentifizierten Client. Kopieren
 * statt neu laden löst damit gleich drei Dinge: keine Anmeldefrage, kein
 * zweiter Download, und es funktioniert auch ohne Netz.
 *
 * MediaStore statt setDestinationInExternalPublicDir: Ab Android 10 ist der
 * direkte Schreibzugriff auf das öffentliche Download-Verzeichnis nicht mehr
 * erlaubt (Scoped Storage); der MediaStore ist der vorgesehene Weg und braucht
 * keine Berechtigung.
 */
private fun savePdfToDownloads(ctx: Context, file: File, title: String) {
    try {
        val safe = (title.ifBlank { "anleitung" }).replace(Regex("[^A-Za-z0-9._-]"), "_")
        val name = if (safe.endsWith(".pdf", true)) safe else "$safe.pdf"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Ab Android 10: MediaStore. IS_PENDING blendet die Datei aus,
            // solange geschrieben wird — sonst könnte eine andere App sie
            // halbfertig öffnen.
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = ctx.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException(ctx.getString(R.string.pdfview_no_target))
            resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
                ?: throw IllegalStateException(ctx.getString(R.string.pdfview_write_failed))
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            Toast.makeText(ctx, ctx.getString(R.string.pdfview_saved, name), Toast.LENGTH_SHORT).show()
        } else {
            // Android 8 und 9 (minSdk ist 26): MediaStore.Downloads gibt es hier
            // noch nicht, und in den öffentlichen Downloads-Ordner zu schreiben
            // verlangt WRITE_EXTERNAL_STORAGE — eine Laufzeitberechtigung, die
            // die App sonst nirgends braucht.
            //
            // Der DownloadManager umging das früher, weil der System-Dienst mit
            // eigenen Rechten schreibt. Genau dieser Dienst war aber das
            // Problem: Er kennt unseren Bearer-Token nicht (siehe oben).
            //
            // Deshalb hier das app-eigene Verzeichnis — es braucht keine
            // Berechtigung, ist über die Dateien-App erreichbar, und der
            // Teilen-Dialog macht die Datei sofort weiterverwendbar. Für eine
            // Berechtigungsabfrage nur für zwei alte Android-Versionen ist der
            // Nutzen zu klein.
            // Genau das Verzeichnis, das der FileProvider freigibt: res/xml/file_paths.xml
            // exportiert bewusst NUR <external-files>/pdf/ und <files>/pdf/ — die
            // Freigabe wurde einmal gezielt darauf verengt, damit nicht der ganze
            // Cache (API-Antworten im Klartext, Bilder) über die Authority
            // erreichbar ist. Ein anderer Ordner hier würde den Teilen-Dialog mit
            // "Failed to find configured root" abbrechen lassen.
            val base = ctx.getExternalFilesDir(null) ?: ctx.filesDir
            val dir = java.io.File(base, "pdf")
            dir.mkdirs()
            val target = java.io.File(dir, name)
            file.copyTo(target, overwrite = true)

            val shareUri = androidx.core.content.FileProvider.getUriForFile(
                ctx, ctx.packageName + ".provider", target)
            ctx.startActivity(
                android.content.Intent.createChooser(
                    android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                        type = "application/pdf"
                        putExtra(android.content.Intent.EXTRA_STREAM, shareUri)
                        addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }, ctx.getString(R.string.pdfview_share)
                ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    } catch (e: Exception) {
        Toast.makeText(ctx, ctx.getString(R.string.pdfview_save_failed, e.message ?: ""), Toast.LENGTH_LONG).show()
    }
}

private fun Context.findActivity(): Activity? {
    var c: Context = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

private fun formatMb(bytes: Long): String {
    if (bytes <= 0) return "0 MB"
    val mb = bytes / 1_048_576.0
    // Locale AUSDRUECKLICH: `String.format` ohne Locale nimmt ohnehin die
    // voreingestellte — Lint beanstandet, dass das nicht dasteht, und damit
    // hat es recht. Hier ist getDefault() auch das Richtige: Die Zahl wird
    // ANGEZEIGT, ein deutscher Nutzer erwartet „1,5 MB" mit Komma.
    return if (mb >= 1024) String.format(java.util.Locale.getDefault(), "%.2f GB", mb / 1024)
           else String.format(java.util.Locale.getDefault(), "%.1f MB", mb)
}
