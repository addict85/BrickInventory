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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
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
import ch.brickinventoryapp.util.pdfAblage
import ch.brickinventoryapp.util.pdfSchritt
import ch.brickinventoryapp.util.vergissPdf
import ch.brickinventoryapp.ui.theme.Formen
import kotlin.math.ceil
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * In-App PDF-Viewer für grosse Anleitungen: Der Download läuft streamend auf die
 * Platte, PdfRenderer rendert die Seiten einzeln, es liegt nur das Sichtbare als
 * Bitmap im Speicher. „Herunterladen“ kopiert die geladene Datei, statt sie über
 * den DownloadManager neu zu holen — der kennt den Bearer-Token nicht.
 */
// ── Zoom ──
//
// Der Faktor gilt auf „Seite füllt die Breite“; 1 ist deshalb der untere Anschlag,
// wie im Bildzoom und in der Weboberfläche.
private const val PDF_ZOOM_MIN = 1f
private const val PDF_ZOOM_MAX = 5f
private const val PDF_ZOOM_SCHRITT = 1.25f      // ein Druck auf + bzw. −
private const val PDF_ZOOM_DOPPELTIPP = 2.5f    // Doppeltipp aus 1x heraus

/**
 * Obergrenze einer Seiten-Bitmap in Pixeln der Fläche: 8 Millionen ARGB-Pixel sind
 * rund 32 MB. Begrenzt wird die Fläche, weil sie den Speicher bestimmt; wird sie
 * erreicht, wird die Seite nur weicher, nicht falsch.
 */
internal const val PDF_BITMAP_MAX_PX = 8_000_000

/**
 * In welcher Stufe gerendert wird — 1-, 2- oder 3-mal die Behälterbreite. Stufen
 * statt stufenlos: Der Faktor ändert sich mit jedem Bild der Geste, und jeder
 * Wechsel kostet einen PdfRenderer-Durchlauf; so sind es auf dem Weg von 1x nach
 * 5x höchstens zwei.
 */
internal fun renderStufe(zoom: Float): Int = ceil(zoom).toInt().coerceIn(1, 3)

/**
 * Masse der Seiten-Bitmap: die gewünschte Breite, auf [PDF_BITMAP_MAX_PX]
 * begrenzt.
 *
 * @param breitePx gewünschte Breite in Pixeln
 * @param ratio Höhe geteilt durch Breite der PDF-Seite
 * @return (Breite, Höhe) in Pixeln, beide mindestens 1
 *
 * Gekappt wird mit der Wurzel, damit beide Seiten gleich schrumpfen und das
 * Verhältnis bleibt. Eigene Funktion, damit die Rechnung ohne Gerät prüfbar ist
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
    // stringResource statt ctx.getString im Rückruf: Ein aus LocalContext gegriffener
    // Context liefert nach einem Konfigurationswechsel veraltete Werte (Lint
    // LocalContextGetResourceValueCall).
    val ladefehlerText = stringResource(R.string.pdfview_download_failed)
    val unbekannterFehlerText = stringResource(R.string.pdfview_unknown_error)
    var state by remember(pdfUrl) { mutableStateOf<PdfLoadState>(PdfLoadState.Downloading(0, 0, 0)) }
    // Der Zoom gehoert hierher und nicht in PdfPages: Die Knoepfe sitzen in der
    // Kopfzeile, die Geste in der Liste, und der Faktor wird unten angezeigt —
    // drei Stellen, eine Wahrheit. Zurueck auf 1x bei einem anderen PDF.
    var zoom by remember(pdfUrl) { mutableFloatStateOf(PDF_ZOOM_MIN) }
    val anker = remember(pdfUrl) { ZoomAnker() }
    // Ein Gutschein-PDF trägt Nummer und PIN: eigener Ordner, und beim Verlassen weg
    // (dazu FLAG_SECURE über Sichtschutz im Graphen). Anleitungen bleiben im Zwischenspeicher.
    val vertraulich = remember(pdfUrl) { ch.brickinventoryapp.ui.viewmodel.zeigtGutscheine(pdfUrl) }
    val ablage = remember(pdfUrl) { pdfAblage(ctx.cacheDir, pdfUrl, vertraulich) }
    DisposableEffect(ablage) {
        onDispose { if (vertraulich) vergissPdf(ablage) }
    }
    // Geste und Doppeltipp zoomen um ihren Punkt, die Knoepfe (null) um die Mitte.
    val setzeZoom = { neu: Float, punkt: Offset? ->
        anker.punkt = punkt
        zoom = neu.coerceIn(PDF_ZOOM_MIN, PDF_ZOOM_MAX)
    }

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
            val cacheFile = ablage
            withContext(Dispatchers.IO) { cacheFile.parentFile?.mkdirs() }
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
                is PdfLoadState.Ready -> PdfPages(s.file, s.pageCount, zoom, anker, setzeZoom)
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
                    setzeZoom = { setzeZoom(it, null) },
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
 * Minus, Faktor, Plus — unten in der Mitte: Die Kopfzeile trägt schon Zurück,
 * Drucken und Herunterladen, und mehr Knöpfe liessen dem Titel kaum Platz; unten
 * ist der Daumen. Immer sichtbar, weil die Leiste hier der verlässliche Weg zum
 * Zoomen ist — die Geste kann gegen das Rollen verlieren. Der Faktor steht als
 * Zahl da, nicht als Farbe.
 */
@Composable
private fun ZoomLeiste(zoom: Float, setzeZoom: (Float) -> Unit, modifier: Modifier = Modifier) {
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
        IconButton(
            onClick = { setzeZoom(zoom / PDF_ZOOM_SCHRITT) },
            enabled = zoom > PDF_ZOOM_MIN + 0.01f
        ) {
            Icon(Icons.Default.ZoomOut, contentDescription = stringResource(R.string.pdfview_zoom_out))
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
        IconButton(
            onClick = { setzeZoom(zoom * PDF_ZOOM_SCHRITT) },
            enabled = zoom < PDF_ZOOM_MAX - 0.01f
        ) {
            Icon(Icons.Default.ZoomIn, contentDescription = stringResource(R.string.pdfview_zoom_in))
        }
    }
}

/**
 * Die Seiten, zoombar. Gezoomt wird über die Breite statt mit einem graphicsLayer:
 * So rendert PdfPage in der Grösse, in der die Seite steht (scharf statt
 * gestreckt), das Rollen bleibt im richtigen Mass, und ein echtes horizontalScroll
 * verschiebt mit Anschlag. transformable(canPan = { false }) beansprucht keinen
 * Einfinger-Zug, deshalb rollt die Liste weiter; wo die Geste doch verliert,
 * bleiben Doppeltipp und Knöpfe.
 */
/**
 * Was ein Zoomschritt von der Geste bis zur naechsten Messung braucht. Kein
 * Compose-Zustand: Nur das Messen liest es, neu zeichnen soll es nichts.
 */
private class ZoomAnker {
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
private fun PdfPages(
    file: File, pageCount: Int, zoom: Float, anker: ZoomAnker, setzeZoom: (Float, Offset?) -> Unit,
) {
    val dichte = LocalDensity.current
    val waagrecht = rememberScrollState()
    val senkrecht = rememberLazyListState()
    val geste = rememberTransformableState { zoomChange, _, _ -> setzeZoom(zoom * zoomChange, anker.finger) }

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
                    PdfPage(file, index, renderBreitePx)
                }
            }
        }
    }
}

@Composable
private fun PdfPage(file: File, index: Int, renderBreitePx: Int) {
    var bitmap by remember(file, index) { mutableStateOf<Bitmap?>(null) }

    // remember ohne, LaunchedEffect mit renderBreitePx: Beim Stufenwechsel bleibt die
    // alte Bitmap stehen, bis die neue da ist. Ein Ladekreis hätte eine andere Höhe
    // und verlöre beim Zoomen die Stelle in der Anleitung.
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
 * Robuster Download grosser PDFs mit OkHttp: - callTimeout(0): kein
 * Gesamt-Timeout, 300 MB dürfen lange laden - retryOnConnectionFailure -
 * Range-Request: Ein abgebrochener Download wird an der Abbruchstelle fortgesetzt,
 * bis zu maxAttempts Versuche
 */
/**
 * Laden und Seiten zählen — mit einem Selbstheilungsversuch: Ältere Fassungen
 * schrieben direkt unter den fertigen Namen und konnten dort eine abgeschnittene
 * Datei hinterlassen. Scheitert das Öffnen, wird der Zwischenspeicher dieser
 * Anleitung verworfen und einmal neu geladen; ein zweiter Fehlschlag geht durch,
 * sonst liefe eine Schleife über 300 MB.
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
 * Hält den PDF-Ansichts-Cache unter [PDF_CACHE_BUDGET_BYTES]. Angesehene
 * Anleitungen bleiben liegen (erneutes Öffnen, Fortsetzen eines Teil-Downloads),
 * brauchen aber eine Obergrenze. Älteste zuerst; [keep] — die gerade angeforderte
 * Datei — wird nie gelöscht.
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
     * Meldung, wenn alle Versuche gescheitert sind und die Ursache keine trägt. Als
     * Parameter, damit diese Funktion auf dem IO-Dispatcher ohne Context auskommt.
     */
    fehlerText: String,
    onProgress: (downloaded: Long, total: Long) -> Unit
) {
    // Vom geteilten api-Client abgeleitet: newBuilder() übernimmt die Interceptors
    // (Bearer-Token, Klartext-Verbot, 401-Meldung) und die Pools; nur die Zeitgrenzen
    // weichen ab.
    val client = baseClient.newBuilder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    // Der laufende Download schreibt in `<name>.part`; erst der Abschluss benennt um.
    // Ohne diese Trennung wäre eine fertige Datei nicht von einer abgebrochenen zu
    // unterscheiden (siehe util/PdfCache.kt).
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
                        // Kein `?:`: `resp.body` ist seit OkHttp 5 nicht nullbar.
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
                                    // Verlassen bricht ab: Ein Gutschein-PDF darf nach dem Löschen nicht neu entstehen.
                                    kotlinx.coroutines.currentCoroutineContext().ensureActive()
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
 * Die geladene PDF-Datei in den Download-Ordner kopieren — ohne zweiten Download:
 * Der DownloadManager kennt unseren Bearer-Token nicht und legte die 401-Antwort
 * als „anleitung.pdf“ ab. Kopieren geht auch offline. Ab Android 10 über den
 * MediaStore, der keine Berechtigung braucht.
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
            // Android 8 und 9 kennen MediaStore.Downloads nicht, und der öffentliche Ordner
            // bräuchte WRITE_EXTERNAL_STORAGE. Deshalb das app-eigene Verzeichnis, erreichbar
            // über die Dateien-App und den Teilen-Dialog. Genau das Verzeichnis, das
            // res/xml/file_paths.xml freigibt — ein anderes liesse den Teilen-Dialog an
            // „Failed to find configured root“ scheitern.
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
