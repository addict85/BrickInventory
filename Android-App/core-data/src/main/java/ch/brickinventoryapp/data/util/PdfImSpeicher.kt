package ch.brickinventoryapp.data.util

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import ch.brickinventoryapp.data.DownloadGescheitert
import java.io.IOException

/** Obergrenze eines PDFs, das nur im Speicher liegen darf; ein Gutschein-Export hat wenige hundert kB. */
internal const val PDF_SPEICHER_MAX_BYTES: Long = 32L * 1024 * 1024

/**
 * Lädt ein vertrauliches PDF (Gutscheine: Nummer und PIN) ganz in den Speicher, ohne
 * Teildatei: Was nie auf der Platte lag, bleibt auch nach einem Absturz nicht liegen.
 * Mit Obergrenze, weil eine Antwort ohne Ende sonst den Speicher füllte. Blockiert:
 * im Hintergrund aufrufen.
 */
suspend fun ladePdfInDenSpeicher(
    client: OkHttpClient,
    url: String,
    grenze: Long = PDF_SPEICHER_MAX_BYTES,
    fortschritt: (geladen: Long, gesamt: Long) -> Unit = { _, _ -> },
): ByteArray =
    client.newCall(Request.Builder().url(url).build()).execute().use { antwort ->
        if (!antwort.isSuccessful) throw DownloadGescheitert(antwort.code)
        val gesamt = antwort.body.contentLength()
        if (gesamt > grenze) throw IOException("PDF zu gross: $gesamt Bytes")
        val inhalt = ByteArrayOutputStream(if (gesamt > 0) gesamt.toInt() else 64 * 1024)
        antwort.body.byteStream().use { ein ->
            val stueck = ByteArray(64 * 1024)
            while (true) {
                // Verlassen bricht ab, statt eine PIN weiter in den Speicher zu holen.
                currentCoroutineContext().ensureActive()
                val n = ein.read(stueck)
                if (n < 0) break
                if (inhalt.size() + n > grenze) throw IOException("PDF zu gross: über $grenze Bytes")
                inhalt.write(stueck, 0, n)
                fortschritt(inhalt.size().toLong(), gesamt)
            }
        }
        inhalt.toByteArray()
    }
