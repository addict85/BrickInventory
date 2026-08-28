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
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
    var state by remember(pdfUrl) { mutableStateOf<PdfLoadState>(PdfLoadState.Downloading(0, 0, 0)) }

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
            val file = withContext(Dispatchers.IO) {
                val cacheFile = File(ctx.cacheDir, "pdfview_${pdfUrl.hashCode()}.pdf")
                prunePdfCache(ctx.cacheDir, keep = cacheFile)
                downloadPdfWithResume(
                    pdfUrl, cacheFile, httpClient,
                    ctx.getString(R.string.pdfview_download_failed),
                    ctx.getString(R.string.pdfview_empty_response)
                ) { downloaded, total ->
                    val pct = if (total > 0) (downloaded * 100 / total).toInt() else 0
                    state = PdfLoadState.Downloading(pct, downloaded, if (total > 0) total else 0L)
                }
                cacheFile
            }
            state = PdfLoadState.Rendering
            val pageCount = withContext(Dispatchers.IO) {
                val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                val renderer = PdfRenderer(pfd)
                val count = renderer.pageCount
                renderer.close()
                pfd.close()
                count
            }
            state = PdfLoadState.Ready(file, pageCount)
        } catch (e: Exception) {
            state = PdfLoadState.Error(e.message ?: ctx.getString(R.string.pdfview_unknown_error))
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
                is PdfLoadState.Ready -> PdfPages(s.file, s.pageCount)
                is PdfLoadState.Error -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text(
                        stringResource(R.string.pdfview_load_failed, s.message),
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(24.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun DownloadProgress(s: PdfLoadState.Downloading) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(24.dp)
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
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            CircularProgressIndicator()
            Text(text)
        }
    }
}

@Composable
private fun PdfPages(file: File, pageCount: Int) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items((0 until pageCount).toList()) { index ->
            PdfPage(file, index)
        }
    }
}

@Composable
private fun PdfPage(file: File, index: Int) {
    var bitmap by remember(file, index) { mutableStateOf<Bitmap?>(null) }

    LaunchedEffect(file, index) {
        bitmap = withContext(Dispatchers.IO) { renderPdfPage(file, index, targetWidthPx = 1080) }
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
            val w = targetWidthPx
            val h = (w * ratio).toInt().coerceAtLeast(1)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
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
        val files = cacheDir.listFiles { f ->
            f.isFile && f.name.startsWith("pdfview_") && f.name.endsWith(".pdf")
        }?.sortedByDescending { it.lastModified() } ?: return

        var used = 0L
        for (f in files) {
            // Die aktuell angeforderte Datei zählt zum Budget, wird aber nie gelöscht
            if (f.absolutePath == keep.absolutePath) { used += f.length(); continue }
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
    /** Meldung für eine Antwort ohne Rumpf — aus demselben Grund ein Parameter. */
    leerText: String,
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

    val maxAttempts = 8
    var lastError: Exception? = null
    for (attempt in 1..maxAttempts) {
        val existing = if (dest.exists()) dest.length() else 0L
        val reqBuilder = Request.Builder().url(url)
        if (existing > 0) reqBuilder.header("Range", "bytes=$existing-")
        try {
            client.newCall(reqBuilder.build()).execute().use { resp ->
                if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
                // Server unterstützt Range → 206; ignoriert Range → 200 (neu starten).
                val resuming = resp.code == 206 && existing > 0
                if (existing > 0 && !resuming) dest.delete()
                val body = resp.body ?: throw IOException(leerText)
                val total: Long = if (resuming) {
                    resp.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
                        ?: (existing + body.contentLength())
                } else {
                    body.contentLength()
                }
                var downloaded = if (resuming) existing else 0L
                RandomAccessFile(dest, "rw").use { raf ->
                    if (resuming) raf.seek(existing) else raf.setLength(0)
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
            return // Erfolg
        } catch (e: Exception) {
            lastError = e
            if (attempt < maxAttempts) delay((1000L * attempt).coerceAtMost(4000L)) // Pause, dann Resume
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
    return if (mb >= 1024) String.format("%.2f GB", mb / 1024) else String.format("%.1f MB", mb)
}
