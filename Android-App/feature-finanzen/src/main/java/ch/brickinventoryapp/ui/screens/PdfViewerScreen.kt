package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.util.fangeAusserAbbruch
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.provider.MediaStore
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.WindowManager
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
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.util.AnleitungsAblage
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.pdf.PdfFehler
import ch.brickinventoryapp.ui.pdf.PdfLoadState
import ch.brickinventoryapp.ui.pdf.PdfQuelle
import ch.brickinventoryapp.ui.pdf.SeitenRenderer
import ch.brickinventoryapp.ui.pdf.PdfDruckAdapter
import ch.brickinventoryapp.ui.pdf.PdfSchreiber
import kotlinx.coroutines.CoroutineScope
import ch.brickinventoryapp.ui.viewmodel.PdfBetrachterViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * In-App PDF-Viewer für grosse Anleitungen: Der Download läuft streamend und
 * verschlüsselt auf die Platte ([AnleitungsAblage]; Gutscheine nur in den Speicher),
 * angezeigt wird aus einem Bereich ohne Namen ([PdfQuelle]). PdfRenderer rendert die
 * Seiten einzeln. „Herunterladen“ kopiert die geladene Anleitung, statt sie über den
 * DownloadManager neu zu holen — der kennt den Bearer-Token nicht.
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
 * In welcher Stufe gerendert wird — 1-, 2- oder 3-mal die Behälterbreite. Stufen
 * statt stufenlos: Der Faktor ändert sich mit jedem Bild der Geste, und jeder
 * Wechsel kostet einen PdfRenderer-Durchlauf; so sind es auf dem Weg von 1x nach
 * 5x höchstens zwei.
 */
internal fun renderStufe(zoom: Float): Int = ceil(zoom).toInt().coerceIn(1, 3)

/**
 * Der Betrachter am Navigationsziel: holt das ViewModel und stösst das Laden an.
 * Der Bildschirm darunter bekommt nur noch den Zustand.
 */
@Composable
fun PdfViewerRoute(
    pdfUrl: String,
    title: String,
    /** Nur Adressen dieses Servers lädt der Betrachter (pdfImBetrachter). */
    serverUrl: String,
    onBack: () -> Unit,
    vm: PdfBetrachterViewModel = hiltViewModel(),
) {
    LaunchedEffect(pdfUrl, serverUrl) { vm.oeffne(pdfUrl, serverUrl) }
    val state by vm.state.collectAsStateWithLifecycle()
    PdfViewerScreen(
        state = state,
        title = title,
        speicherbar = remember(pdfUrl) { ch.brickinventoryapp.ui.viewmodel.pdfDarfGespeichertWerden(pdfUrl) },
        onBack = onBack,
        rendereSeite = vm::seite,
        schreibe = vm.schreiber,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfViewerScreen(
    state: PdfLoadState,
    title: String,
    /** Herunterladen und Drucken nur, wo die Datei das Gerät verlassen darf (keine Gutscheine). */
    speicherbar: Boolean,
    onBack: () -> Unit,
    /** Rendert eine Seite abseits des Hauptfadens (PdfBetrachterViewModel.seite). */
    rendereSeite: SeitenRenderer,
    /** Schreibt die Datei für den Druck, abseits des Hauptfadens (PdfBetrachterViewModel.schreiber). */
    schreibe: PdfSchreiber,
) {
    val ctx = LocalContext.current
    // Rückmeldungen von Drucken und Herunterladen als Snackbar im eigenen Gerüst: Ein
    // Toast verschwand, bevor TalkBack ihn fertig gelesen hatte, und trug kein Design.
    val meldungen = remember { SnackbarHostState() }
    val bereich = rememberCoroutineScope()
    val melde: (String?) -> Unit = { text -> if (text != null) bereich.launch { meldungen.showSnackbar(text) } }
    // Der Zoom gehoert hierher und nicht in PdfPages: Die Knoepfe sitzen in der
    // Kopfzeile, die Geste in der Liste, und der Faktor wird unten angezeigt —
    // drei Stellen, eine Wahrheit.
    var zoom by remember { mutableFloatStateOf(PDF_ZOOM_MIN) }
    val anker = remember { ZoomAnker() }
    // Geste und Doppeltipp zoomen um ihren Punkt, die Knoepfe (null) um die Mitte.
    val setzeZoom = { neu: Float, punkt: Offset? ->
        anker.punkt = punkt
        zoom = neu.coerceIn(PDF_ZOOM_MIN, PDF_ZOOM_MAX)
    }

    // Bildschirm WÄHREND DES LADENS anlassen: Geht das Display aus, trennt Android
    // (je nach Gerät/WLAN-Sleep) kurz das Netzwerk. Danach wieder frei (Akku).
    val isLoading = state is PdfLoadState.Downloading || state is PdfLoadState.Rendering
    DisposableEffect(isLoading) {
        val window = ctx.findActivity()?.window
        if (isLoading) window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(meldungen) },
        topBar = {
            TopAppBar(
                title = { Text(title.ifBlank { "PDF" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    ch.brickinventoryapp.ui.components.MitTooltip(stringResource(R.string.common_back)) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                        }
                    }
                },
                actions = {
                    // Erst im Zustand Ready: Beide Knöpfe arbeiten auf der geladenen
                    // Datei, ein eigener Download kennte den Bearer-Token nicht. Beide nur,
                    // wo Speichern erlaubt ist: Der Druckdialog bietet „Als PDF speichern“.
                    val s = state
                    if (s is PdfLoadState.Ready) {
                        if (speicherbar) {
                            ch.brickinventoryapp.ui.components.MitTooltip(stringResource(R.string.pdfview_download)) {
                                IconButton(onClick = { melde(savePdfToDownloads(ctx, s.quelle, title)) }) {
                                    Icon(Icons.Default.Download, contentDescription = stringResource(R.string.pdfview_download))
                                }
                            }
                            ch.brickinventoryapp.ui.components.MitTooltip(stringResource(R.string.pdfview_print)) {
                                IconButton(onClick = { melde(printPdf(ctx, s.quelle, title, schreibe, bereich)) }) {
                                    Icon(Icons.Default.Print, contentDescription = stringResource(R.string.pdfview_print))
                                }
                            }
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
                is PdfLoadState.Ready -> PdfPages(s.quelle, s.pageCount, zoom, anker, setzeZoom, rendereSeite)
                is PdfLoadState.Error -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text(
                        stringResource(R.string.pdfview_load_failed, s.message ?: fehlerText(s.grund)),
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
        ch.brickinventoryapp.ui.components.MitTooltip(stringResource(R.string.pdfview_zoom_out)) {
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
        ch.brickinventoryapp.ui.components.MitTooltip(stringResource(R.string.pdfview_zoom_in)) {
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

/** Fehler ohne Ursachentext: der Satz in der Sprache der App. */
@Composable
private fun fehlerText(grund: PdfFehler): String = when (grund) {
    PdfFehler.FREMDER_HOST -> stringResource(R.string.pdfview_fremder_host)
    PdfFehler.DOWNLOAD -> stringResource(R.string.pdfview_download_failed)
    PdfFehler.UNBEKANNT -> stringResource(R.string.pdfview_unknown_error)
}

// Druckt die bereits geladene PDF-Datei über das System-Druckframework. Gibt bei einem
// Fehler die Meldung zurück; das Gelingen zeigt der Druckdialog selbst.
private fun printPdf(ctx: Context, quelle: PdfQuelle, title: String, schreiber: PdfSchreiber, bereich: CoroutineScope): String? {
    return fangeAusserAbbruch {
        val printManager = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
        val jobName = title.ifBlank { ctx.getString(R.string.pdfview_default_name) }
        printManager.print(jobName, PdfDruckAdapter(quelle, jobName, schreiber, bereich), PrintAttributes.Builder().build())
        null
    }.getOrElse { e ->
        ctx.getString(R.string.pdfview_print_failed, e.message ?: "")
    }
}

/**
 * Die geladene PDF-Datei in den Download-Ordner kopieren — ohne zweiten Download:
 * Der DownloadManager kennt unseren Bearer-Token nicht und legte die 401-Antwort
 * als „anleitung.pdf“ ab. Kopieren geht auch offline. Über den MediaStore, der
 * keine Berechtigung braucht. Gibt die Meldung für die Snackbar zurück.
 */
private fun savePdfToDownloads(ctx: Context, quelle: PdfQuelle, title: String): String {
    return fangeAusserAbbruch {
        val safe = (title.ifBlank { "anleitung" }).replace(Regex("[^A-Za-z0-9._-]"), "_")
        val name = if (safe.endsWith(".pdf", true)) safe else "$safe.pdf"

        // IS_PENDING blendet die Datei aus,
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
        resolver.openOutputStream(uri)?.use { out -> quelle.eingang().use { it.copyTo(out) } }
            ?: throw IllegalStateException(ctx.getString(R.string.pdfview_write_failed))
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        ctx.getString(R.string.pdfview_saved, name)
    }.getOrElse { e ->
        ctx.getString(R.string.pdfview_save_failed, e.message ?: "")
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
