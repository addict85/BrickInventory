package ch.brickinventoryapp.finances.ui.screens

import ch.brickinventoryapp.ui.components.DetailTopAppBar
import androidx.compose.ui.semantics.clearAndSetSemantics
import ch.brickinventoryapp.ui.components.ThrottledAnnouncement
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.ContextWrapper
import android.provider.MediaStore
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.WindowManager
import androidx.compose.material.icons.filled.Print
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.finances.ui.pdf.PdfError
import ch.brickinventoryapp.finances.ui.pdf.PdfLoadState
import ch.brickinventoryapp.finances.ui.pdf.PdfQuelle
import ch.brickinventoryapp.finances.ui.pdf.SeitenRenderer
import ch.brickinventoryapp.finances.ui.pdf.PdfPrintAdapter
import ch.brickinventoryapp.finances.ui.pdf.PdfSchreiber
import kotlinx.coroutines.CoroutineScope
import ch.brickinventoryapp.finances.ui.viewmodel.PdfBetrachterViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlin.math.ceil
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.StateHint
import androidx.compose.ui.text.style.TextAlign
import ch.brickinventoryapp.finances.ui.viewmodel.pdfMaySavedBecome

/**
 * In-app PDF viewer for large instruction manuals: the download runs streamed and
 * encrypted onto disk ([InstructionStore]; vouchers only into memory),
 * displayed from an area without a name ([PdfQuelle]). PdfRenderer renders the
 * pages one by one. „Herunterladen“ copies the loaded instruction manual instead of fetching it again via the
 * DownloadManager — that one does not know the bearer token.
 */
// ── Zoom ──
//
// The factor applies to "page fills the width"; 1 is therefore the lower limit,
// as in the image zoom and in the web UI.
internal const val PDF_ZOOM_MIN = 1f
internal const val PDF_ZOOM_MAX = 5f
internal const val PDF_ZOOM_STEP = 1.25f      // one tap on + or −
internal const val PDF_ZOOM_DOPPELTIPP = 2.5f    // double tap out of 1x

/**
 * At which step it is rendered — 1, 2 or 3 times the container width. Steps
 * instead of stepless: the factor changes with every frame of the gesture, and every
 * change costs one PdfRenderer pass; this way it is at most two on the way from 1x to
 * 5x.
 */
internal fun renderLevel(zoom: Float): Int = ceil(zoom).toInt().coerceIn(1, 3)

/**
 * The viewer at the navigation destination: fetches the ViewModel and triggers the loading.
 * The screen underneath now only gets the state.
 */
@Composable
internal fun PdfViewerRoute(
    pdfUrl: String,
    title: String,
    /** The viewer loads only addresses of this server (pdfInViewer). */
    serverUrl: String,
    onBack: () -> Unit,
    vm: PdfBetrachterViewModel = hiltViewModel(),
) {
    LaunchedEffect(pdfUrl, serverUrl) { vm.oeffne(pdfUrl, serverUrl) }
    val state by vm.state.collectAsStateWithLifecycle()
    PdfViewerScreen(
        state = state,
        title = title,
        speicherbar = remember(pdfUrl) { pdfMaySavedBecome(pdfUrl) },
        onBack = onBack,
        rendereSeite = vm.pages::seite,
        schreibe = vm.schreiber,
        onErneut = vm::erneut,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PdfViewerScreen(
    state: PdfLoadState,
    title: String,
    /** Download and print only where the file may leave the device (no vouchers). */
    speicherbar: Boolean,
    onBack: () -> Unit,
    /** Renders a page off the main thread (PdfSeitenQuelle). */
    rendereSeite: SeitenRenderer,
    /** Writes the file for printing, off the main thread (PdfBetrachterViewModel.schreiber). */
    schreibe: PdfSchreiber,
    /** „Erneut versuchen“ in the error state (PdfBetrachterViewModel.erneut). */
    onErneut: () -> Unit,
) {
    val ctx = LocalContext.current
    // Feedback from printing and downloading as a snackbar in the app's own scaffold: a
    // Toast disappeared before TalkBack had finished reading it, and carried no design.
    val meldungen = remember { SnackbarHostState() }
    val bereich = rememberCoroutineScope()
    val melde: (String?) -> Unit = { text -> if (text != null) bereich.launch { meldungen.showSnackbar(text) } }
    // The zoom belongs here and not in PdfPages: the buttons sit in the
    // header, the gesture in the list, and the factor is shown at the bottom —
    // three places, one truth.
    var zoom by remember { mutableFloatStateOf(PDF_ZOOM_MIN) }
    val anker = remember { ZoomAnker() }
    // Gesture and double tap zoom around their point, the buttons (null) around the center.
    val setzeZoom = { neu: Float, point: Offset? ->
        anker.point = point
        zoom = neu.coerceIn(PDF_ZOOM_MIN, PDF_ZOOM_MAX)
    }

    // Keep the screen on WHILE LOADING: if the display goes off, Android
    // briefly disconnects the network (depending on device/Wi-Fi sleep). Free again afterward (battery).
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
            // The set name as the heading, two lines at large font.
            DetailTopAppBar(
                titel = title.ifBlank { "PDF" }, onZurueck = onBack, schliessen = false,
                actions = {
                    // Only in state Ready: both buttons work on the loaded
                    // file, a download of its own would not know the bearer token. Both only
                    // where saving is allowed: the print dialog offers „Als PDF speichern“.
                    val s = state
                    if (s is PdfLoadState.Ready) {
                        if (speicherbar) {
                            MitTooltip(stringResource(R.string.pdfview_download)) {
                                IconButton(onClick = { melde(savePdfToDownloads(ctx, s.quelle, title)) }) {
                                    Icon(Icons.Default.Download, contentDescription = stringResource(R.string.pdfview_download))
                                }
                            }
                            MitTooltip(stringResource(R.string.pdfview_print)) {
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
                is PdfLoadState.Error -> PdfErrorDisplay(s, onErneut)
            }
            if (state is PdfLoadState.Ready) {
                ZoomBar(
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
            modifier = Modifier.padding(Abstaende.veryLarge)
        ) {
            if (s.total > 0) {
                CircularProgressIndicator(progress = { s.pct / 100f })
                Text(stringResource(R.string.pdfview_loading_pct, s.pct), Modifier.clearAndSetSemantics {})
                // The percentage ticks; it is announced every ten seconds.
                ThrottledAnnouncement(stringResource(R.string.pdfview_loading_pct, s.pct))
                Text(
                    "${formatMb(s.bytes)} / ${formatMb(s.total)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                CircularProgressIndicator()
                Text(stringResource(R.string.pdfview_loading_bytes, formatMb(s.bytes)), Modifier.clearAndSetSemantics {})
                ThrottledAnnouncement(stringResource(R.string.pdfview_loading_bytes, formatMb(s.bytes)))
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
 * Heading and advice by error class as everywhere in the app, the exception's
 * text („HTTP 503“) only as a cause underneath. A foreign address does not load on the
 * second try either: there only the sentence, without „Erneut versuchen“.
 */
@Composable
private fun PdfErrorDisplay(s: PdfLoadState.Error, onErneut: () -> Unit) {
    if (s.grund == PdfError.FREMDER_HOST) {
        StateHint { Text(errorText(s.grund), textAlign = TextAlign.Center) }
    } else StateHint {
        ErrorHint(s.message?.let { stringResource(R.string.pdfview_ursache, it) } ?: errorText(s.grund), onErneut, s.klasse)
    }
}

/** Error without a cause text: the sentence in the app's language. */
@Composable
private fun errorText(grund: PdfError): String = when (grund) {
    PdfError.FREMDER_HOST -> stringResource(R.string.pdfview_fremder_host)
    PdfError.DOWNLOAD -> stringResource(R.string.pdfview_download_failed)
    PdfError.UNBEKANNT -> stringResource(R.string.pdfview_unknown_error)
}

// Prints the already loaded PDF file via the system print framework. On an
// error returns the message; success is shown by the print dialog itself.
private fun printPdf(ctx: Context, quelle: PdfQuelle, title: String, schreiber: PdfSchreiber, bereich: CoroutineScope): String? {
    return fangeAusserAbbruch {
        val printManager = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
        val jobName = title.ifBlank { ctx.getString(R.string.pdfview_default_name) }
        printManager.print(jobName, PdfPrintAdapter(quelle, jobName, schreiber, bereich), PrintAttributes.Builder().build())
        null
    }.getOrElse { e ->
        withCause(ctx.getString(R.string.pdfview_print_failed), e)
    }
}

/**
 * Copy the loaded PDF file into the Downloads folder — without a second download:
 * the DownloadManager does not know our bearer token and would store the 401 answer
 * as „anleitung.pdf“. Copying also works offline. Via the MediaStore, which
 * needs no permission. Returns the message for the snackbar.
 */
private fun savePdfToDownloads(ctx: Context, quelle: PdfQuelle, title: String): String {
    return fangeAusserAbbruch {
        val safe = (title.ifBlank { "anleitung" }).replace(Regex("[^A-Za-z0-9._-]"), "_")
        val name = if (safe.endsWith(".pdf", true)) safe else "$safe.pdf"

        // IS_PENDING hides the file
        // while it is being written — otherwise another app could
        // open it half-finished.
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = ctx.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException(ctx.getString(R.string.pdfview_no_target))
        resolver.openOutputStream(uri)?.use { out -> quelle.inbox().use { it.copyTo(out) } }
            ?: throw IllegalStateException(ctx.getString(R.string.pdfview_write_failed))
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        ctx.getString(R.string.pdfview_saved, name)
    }.getOrElse { e ->
        withCause(ctx.getString(R.string.pdfview_save_failed), e)
    }
}

/** The sentence comes first; the exception's text only as an addition, it is often technical („EACCES“). */
private fun withCause(satz: String, e: Throwable): String =
    e.message?.takeIf { it.isNotBlank() }?.let { "$satz ($it)" } ?: satz

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
    // Locale EXPLICITLY: `String.format` without a Locale takes the
    // default one anyway — Lint flags that this is not written out, and it is
    // right to. Here getDefault() is also the correct choice: the number is being
    // DISPLAYED, and a German-speaking user expects „1,5 MB" with a comma.
    return if (mb >= 1024) String.format(java.util.Locale.getDefault(), "%.2f GB", mb / 1024)
           else String.format(java.util.Locale.getDefault(), "%.1f MB", mb)
}
