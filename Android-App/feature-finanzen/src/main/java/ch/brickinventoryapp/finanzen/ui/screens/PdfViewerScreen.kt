package ch.brickinventoryapp.finanzen.ui.screens

import ch.brickinventoryapp.ui.components.DetailTopAppBar
import androidx.compose.ui.semantics.clearAndSetSemantics
import ch.brickinventoryapp.ui.components.GedrosselteAnsage
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
import ch.brickinventoryapp.ressourcen.R
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.data.util.AnleitungsAblage
import ch.brickinventoryapp.finanzen.ui.pdf.PdfFehler
import ch.brickinventoryapp.finanzen.ui.pdf.PdfLoadState
import ch.brickinventoryapp.finanzen.ui.pdf.PdfQuelle
import ch.brickinventoryapp.finanzen.ui.pdf.SeitenRenderer
import ch.brickinventoryapp.finanzen.ui.pdf.PdfDruckAdapter
import ch.brickinventoryapp.finanzen.ui.pdf.PdfSchreiber
import kotlinx.coroutines.CoroutineScope
import ch.brickinventoryapp.finanzen.ui.viewmodel.PdfBetrachterViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlin.math.ceil
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.finanzen.ui.viewmodel.pdfDarfGespeichertWerden

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
internal const val PDF_ZOOM_MIN = 1f
internal const val PDF_ZOOM_MAX = 5f
internal const val PDF_ZOOM_SCHRITT = 1.25f      // ein Druck auf + bzw. −
internal const val PDF_ZOOM_DOPPELTIPP = 2.5f    // Doppeltipp aus 1x heraus

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
        speicherbar = remember(pdfUrl) { pdfDarfGespeichertWerden(pdfUrl) },
        onBack = onBack,
        rendereSeite = vm.seiten::seite,
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
    /** Rendert eine Seite abseits des Hauptfadens (PdfSeitenQuelle). */
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
            // Der Setname als Überschrift, bei grosser Schrift zweizeilig.
            DetailTopAppBar(
                titel = title.ifBlank { "PDF" }, onZurueck = onBack, schliessen = false,
                actions = {
                    // Erst im Zustand Ready: Beide Knöpfe arbeiten auf der geladenen
                    // Datei, ein eigener Download kennte den Bearer-Token nicht. Beide nur,
                    // wo Speichern erlaubt ist: Der Druckdialog bietet „Als PDF speichern“.
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
                Text(stringResource(R.string.pdfview_loading_pct, s.pct), Modifier.clearAndSetSemantics {})
                // Der Prozentwert tickt; angesagt wird er alle zehn Sekunden.
                GedrosselteAnsage(stringResource(R.string.pdfview_loading_pct, s.pct))
                Text(
                    "${formatMb(s.bytes)} / ${formatMb(s.total)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                CircularProgressIndicator()
                Text(stringResource(R.string.pdfview_loading_bytes, formatMb(s.bytes)), Modifier.clearAndSetSemantics {})
                GedrosselteAnsage(stringResource(R.string.pdfview_loading_bytes, formatMb(s.bytes)))
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
