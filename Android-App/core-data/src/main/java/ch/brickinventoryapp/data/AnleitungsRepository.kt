package ch.brickinventoryapp.data

import android.content.Context
import android.net.wifi.WifiManager
import ch.brickinventoryapp.di.ApiClient
import ch.brickinventoryapp.di.BrickDispatchers
import ch.brickinventoryapp.di.Dispatcher
import ch.brickinventoryapp.util.ANLEITUNG_ENDUNG
import ch.brickinventoryapp.util.ANLEITUNG_PRAEFIX
import ch.brickinventoryapp.util.AnleitungsAblage
import ch.brickinventoryapp.util.PdfSchritt
import ch.brickinventoryapp.util.fangeAusserAbbruch
import ch.brickinventoryapp.util.ladePdfInDenSpeicher
import ch.brickinventoryapp.util.pdfSchritt
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/** Alle Versuche scheiterten, ohne dass eine Ursache übrig blieb. */
class DownloadGescheitert : IOException()

/** Das Netz der Anleitungen und Gutschein-PDFs; aufbereitet und gezeigt wird in der Oberfläche. */
interface AnleitungsRepository {
    /**
     * Lädt [url] nach [ziel], über eine Teildatei und mit Fortsetzen. [einmalig]: Die
     * Adresse trägt ein Ticket für genau einen Abruf, also kein zweiter Versuch.
     */
    suspend fun lade(url: String, ziel: File, einmalig: Boolean, fortschritt: (geladen: Long, gesamt: Long) -> Unit)

    /** Ein vertrauliches PDF nur in den Speicher, ohne Teildatei. */
    suspend fun ladeInDenSpeicher(url: String, fortschritt: (geladen: Long, gesamt: Long) -> Unit): ByteArray
}

/**
 * Über den api-Client (Token, Klartext-Verbot, 401-Meldung), mit WLAN-Sperre:
 * Wird der Bildschirm schwarz, legte Android das WLAN sonst schlafen.
 */
class AnleitungsDownload @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    @param:ApiClient private val httpClient: OkHttpClient,
    private val anleitungen: AnleitungsAblage,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : AnleitungsRepository {

    override suspend fun lade(url: String, ziel: File, einmalig: Boolean, fortschritt: (Long, Long) -> Unit) =
        mitWlan {
            withContext(io) {
                ziel.parentFile?.mkdirs()
                prunePdfCache(ctx.cacheDir, keep = ziel)
                downloadPdfWithResume(url, ziel, ladeClient(httpClient), einmalig, fortschritt)
            }
        }

    override suspend fun ladeInDenSpeicher(url: String, fortschritt: (Long, Long) -> Unit): ByteArray =
        mitWlan { withContext(io) { ladePdfInDenSpeicher(ladeClient(httpClient), url, fortschritt = fortschritt) } }

    private suspend fun <T> mitWlan(block: suspend () -> T): T {
        @Suppress("DEPRECATION")
        val wifiLock = (ctx.getSystemService(Context.WIFI_SERVICE) as? WifiManager)
            ?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "brickinv:pdf")
        try {
            fangeAusserAbbruch { wifiLock?.acquire() }
            return block()
        } finally {
            fangeAusserAbbruch { if (wifiLock?.isHeld == true) wifiLock.release() }
        }
    }

    /**
     * Robuster Download grosser PDFs: Ein abgebrochener Download wird per Range an der
     * Abbruchstelle fortgesetzt, bis zu acht Versuche. Der laufende Download schreibt in
     * `<name>.part`; erst der Abschluss benennt um (util/PdfCache.kt).
     */
    private suspend fun downloadPdfWithResume(
        url: String,
        dest: File,
        client: OkHttpClient,
        einmalig: Boolean,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ) {
        val teil = File(dest.path + ".part")

        // Ein Ticket gilt für genau einen Abruf: kein zweiter Versuch, kein Range-Fortsetzen.
        val maxAttempts = if (einmalig) 1 else 8
        var lastError: Throwable? = null
        for (attempt in 1..maxAttempts) {
            when (val schritt = pdfSchritt(
                fertigeGroesse = if (dest.exists()) dest.length() else 0L,
                // Klartextbytes, nicht Dateigrösse: Darauf bezieht sich der Range des Servers.
                teilGroesse    = anleitungen.klartextLaenge(teil),
            )) {
                is PdfSchritt.Fertig -> {
                    // Schon vollstaendig da: kein Netz. Der Fortschritt wird trotzdem
                    // gemeldet, damit die Anzeige nicht bei 0 % stehen bleibt.
                    val len = dest.length()
                    onProgress(len, len)
                    return
                }
                is PdfSchritt.Holen -> {
                    fangeAusserAbbruch {
                        holeAb(client, url, schritt.ab, teil, onProgress)
                        // Erst JETZT heisst die Datei wie die fertige. Schlägt das Umbenennen
                        // fehl, wird kopiert — sonst lädt der nächste Aufruf alles noch einmal.
                        if (!teil.renameTo(dest)) {
                            teil.copyTo(dest, overwrite = true)
                            teil.delete()
                        }
                        return
                    }.onFailure { e ->
                        lastError = e
                        if (attempt < maxAttempts) delay((1000L * attempt).coerceAtMost(4000L))
                    }
                }
            }
        }
        throw lastError ?: DownloadGescheitert()
    }

    /** Ein Abruf ab Byte [ab] in die Teildatei; der Server antwortet mit 206 (fortsetzen) oder 200 (neu). */
    private suspend fun holeAb(client: OkHttpClient, url: String, ab: Long, teil: File, onProgress: (Long, Long) -> Unit) {
        val reqBuilder = Request.Builder().url(url)
        if (ab > 0) reqBuilder.header("Range", "bytes=$ab-")
        client.newCall(reqBuilder.build()).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
            val resuming = resp.code == 206 && ab > 0
            // Kein `?:`: `resp.body` ist seit OkHttp 5 nicht nullbar.
            val body = resp.body
            val total: Long = if (resuming) {
                resp.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
                    ?: (ab + body.contentLength())
            } else {
                body.contentLength()
            }
            var downloaded = if (resuming) ab else 0L
            anleitungen.schreibe(teil, fortsetzen = resuming).use { aus ->
                body.byteStream().use { input ->
                    val buf = ByteArray(64 * 1024)
                    var lastPct = -1
                    var lastEmit = 0L
                    var read = input.read(buf)
                    while (read != -1) {
                        // Verlassen bricht ab, statt im Hintergrund weiterzuladen.
                        currentCoroutineContext().ensureActive()
                        aus.write(buf, 0, read)
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
    }
}

/**
 * Vom geteilten api-Client abgeleitet: newBuilder() übernimmt die Interceptors
 * (Bearer-Token, Klartext-Verbot, 401-Meldung) und die Pools; nur die Zeitgrenzen weichen ab.
 */
private fun ladeClient(baseClient: OkHttpClient): OkHttpClient = baseClient.newBuilder()
    .connectTimeout(30, TimeUnit.SECONDS)
    .readTimeout(120, TimeUnit.SECONDS)
    .callTimeout(0, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()

/**
 * Hält den PDF-Ansichts-Cache unter [PDF_CACHE_BUDGET_BYTES]. Angesehene Anleitungen
 * bleiben liegen (erneutes Öffnen, Fortsetzen), brauchen aber eine Obergrenze. Älteste
 * zuerst; [keep] — die gerade angeforderte Datei samt Teildatei — wird nie gelöscht.
 */
private fun prunePdfCache(cacheDir: File, keep: File) {
    try {
        // `.part` mit gezählt: Ein abgebrochener 300-MB-Download belegt denselben Platz.
        val files = cacheDir.listFiles { f ->
            f.isFile && f.name.startsWith(ANLEITUNG_PRAEFIX) &&
                (f.name.endsWith(ANLEITUNG_ENDUNG) || f.name.endsWith("$ANLEITUNG_ENDUNG.part"))
        }?.sortedByDescending { it.lastModified() } ?: return

        val geschont = setOf(keep.absolutePath, keep.absolutePath + ".part")
        var used = 0L
        for (f in files) {
            used += f.length()
            if (f.absolutePath !in geschont && used > PDF_CACHE_BUDGET_BYTES) f.delete()
        }
    } catch (_: Exception) { /* Best effort — Aufräumen darf den Download nie verhindern */ }
}

private const val PDF_CACHE_BUDGET_BYTES = 500L * 1024 * 1024
