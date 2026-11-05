package ch.brickinventoryapp.ui.pdf

import ch.brickinventoryapp.util.fangeAusserAbbruch
import android.content.Context
import android.graphics.pdf.PdfRenderer
import android.net.wifi.WifiManager
import ch.brickinventoryapp.di.BrickDispatchers
import ch.brickinventoryapp.di.Dispatcher
import ch.brickinventoryapp.ui.viewmodel.pdfMitEinmalTicket
import ch.brickinventoryapp.ui.viewmodel.zeigtGutscheine
import ch.brickinventoryapp.util.ANLEITUNG_ANZEIGE_ORDNER
import ch.brickinventoryapp.util.ANLEITUNG_ENDUNG
import ch.brickinventoryapp.util.ANLEITUNG_PRAEFIX
import ch.brickinventoryapp.util.AnleitungsAblage
import ch.brickinventoryapp.util.PdfSchritt
import ch.brickinventoryapp.util.ladePdfInDenSpeicher
import ch.brickinventoryapp.util.pdfAblage
import ch.brickinventoryapp.util.pdfSchritt
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CancellationException
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
import javax.inject.Named

/** Lädt ein PDF für den Betrachter; [offen] bekommt die Quelle, bevor sie zurückkommt. */
interface PdfLader {
    suspend fun lade(pdfUrl: String, offen: PdfHalter, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int>
}

@Module
@InstallIn(SingletonComponent::class)
internal interface PdfLaderModul {
    @Binds fun lader(l: AnleitungsLader): PdfLader
}

/**
 * Download, Ablage und Aufbereitung grosser Anleitungen, ausserhalb der Komposition:
 * Eine Drehung baut den Bildschirm neu, der Download im ViewModel läuft weiter.
 * Anleitungen gehen streamend und verschlüsselt auf die Platte ([AnleitungsAblage]),
 * Gutscheine nur in den Speicher.
 */
class AnleitungsLader @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    // Der api-Client: Token, Klartext-Verbot und 401-Meldung gelten auch hier.
    @param:Named("api") private val httpClient: OkHttpClient,
    private val anleitungen: AnleitungsAblage,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : PdfLader {

    override suspend fun lade(pdfUrl: String, offen: PdfHalter, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int> {
        // Ein Gutschein-PDF trägt Nummer und PIN: keine Datei (ablage == null), nur ein
        // Speicherbereich, der mit dem Betrachter vergeht.
        val vertraulich = zeigtGutscheine(pdfUrl)
        val ablage = pdfAblage(ctx.cacheDir, pdfUrl, vertraulich)
        // WLAN wachhalten: Wird der Bildschirm schwarz (auch manuelle Sperre), kann
        // Android sonst das WLAN schlafen legen → DNS-/Verbindungsabbruch.
        @Suppress("DEPRECATION")
        val wifiLock = (ctx.getSystemService(Context.WIFI_SERVICE) as? WifiManager)
            ?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "brickinv:pdf")
        try {
            try { wifiLock?.acquire() } catch (_: Exception) {}
            val (quelle, pageCount) = if (ablage == null) {
                ladeInDenSpeicherUndZaehle(pdfUrl, offen, onZustand)
            } else {
                withContext(io) { ablage.parentFile?.mkdirs() }
                ladeUndZaehle(
                    pdfUrl, ablage, offen,
                    anzeige = File(ctx.cacheDir, ANLEITUNG_ANZEIGE_ORDNER),
                    aufraeumen = { prunePdfCache(ctx.cacheDir, keep = ablage) },
                    onZustand = onZustand,
                )
            }
            return quelle to pageCount
        } finally {
            try { if (wifiLock?.isHeld == true) wifiLock.release() } catch (_: Exception) {}
        }
    }

    /**
     * Laden und Seiten zählen — mit einem Selbstheilungsversuch: Ältere Fassungen
     * schrieben direkt unter den fertigen Namen und konnten dort eine abgeschnittene
     * Datei hinterlassen. Scheitert das Öffnen, wird der Zwischenspeicher dieser
     * Anleitung verworfen und einmal neu geladen; ein zweiter Fehlschlag geht durch.
     */
    private suspend fun ladeUndZaehle(
        url: String,
        cacheFile: File,
        offen: PdfHalter,
        anzeige: File,
        aufraeumen: () -> Unit,
        onZustand: (PdfLoadState) -> Unit,
    ): Pair<PdfQuelle, Int> {
        var versuch = 0
        while (true) {
            versuch++
            withContext(io) {
                aufraeumen()
                downloadPdfWithResume(url, cacheFile, ladeClient(httpClient)) { geladen, gesamt ->
                    val pct = if (gesamt > 0) (geladen * 100 / gesamt).toInt() else 0
                    onZustand(PdfLoadState.Downloading(pct, geladen, if (gesamt > 0) gesamt else 0L))
                }
            }
            onZustand(PdfLoadState.Rendering)
            fangeAusserAbbruch {
                return withContext(io) {
                    val quelle = PdfBereich.anleitung(anleitungen, cacheFile, anzeige)
                    if (!offen.halte(quelle)) throw CancellationException("Betrachter verlassen")
                    quelle to seitenzahl(quelle)
                }
            }.onFailure { e ->
                if (versuch >= 2 || pdfMitEinmalTicket(url)) throw e
                withContext(io) {
                    cacheFile.delete()
                    File(cacheFile.path + ".part").delete()
                }
                onZustand(PdfLoadState.Downloading(0, 0, 0))
            }
        }
    }

    /**
     * Der Weg für vertrauliche PDFs: ganz in den Speicher ([ladePdfInDenSpeicher]), ohne
     * Teildatei und ohne Wiederaufnahme, dann in einen memfd ([PdfBereich.speicher]).
     */
    private suspend fun ladeInDenSpeicherUndZaehle(
        url: String,
        offen: PdfHalter,
        onZustand: (PdfLoadState) -> Unit,
    ): Pair<PdfQuelle, Int> {
        val inhalt = withContext(io) {
            ladePdfInDenSpeicher(ladeClient(httpClient), url) { geladen, gesamt ->
                val pct = if (gesamt > 0) (geladen * 100 / gesamt).toInt() else 0
                onZustand(PdfLoadState.Downloading(pct, geladen, if (gesamt > 0) gesamt else 0L))
            }
        }
        onZustand(PdfLoadState.Rendering)
        return withContext(io) {
            val quelle = PdfBereich.speicher(inhalt)
            if (!offen.halte(quelle)) throw CancellationException("Betrachter verlassen")
            quelle to seitenzahl(quelle)
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
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ) {
        val teil = File(dest.path + ".part")

        // Ein Ticket gilt für genau einen Abruf: kein zweiter Versuch, kein Range-Fortsetzen.
        val maxAttempts = if (pdfMitEinmalTicket(url)) 1 else 8
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

/** Seitenzahl über einen eigenen Deskriptor; zugleich die Probe, dass PdfRenderer das PDF lesen kann. */
private fun seitenzahl(quelle: PdfQuelle): Int {
    val pfd = quelle.oeffne()
    try {
        val renderer = PdfRenderer(pfd)
        try {
            return renderer.pageCount
        } finally {
            renderer.close()
        }
    } finally {
        pfd.close()
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
