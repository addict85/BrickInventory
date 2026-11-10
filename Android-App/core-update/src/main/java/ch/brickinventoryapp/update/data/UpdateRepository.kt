package ch.brickinventoryapp.update.data

import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import ch.brickinventoryapp.model.koroutinen.Dispatcher
import ch.brickinventoryapp.data.di.UpdateClient
import ch.brickinventoryapp.model.util.AppFassung
import ch.brickinventoryapp.update.util.UPDATE_JSON_MAX_BYTES
import ch.brickinventoryapp.update.util.UPDATE_MAX_BYTES
import ch.brickinventoryapp.update.util.UPDATE_VERSION_URL
import ch.brickinventoryapp.update.util.UpdateBeschreibung
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import javax.inject.Inject

/** Die Netzseite der Selbstaktualisierung: Beschreibung und APK holen. Prüfen und installieren bleibt im ViewModel. */
interface UpdateRepository {
    /** Die installierte Fassung; mit ihr vergleicht die Prüfung. */
    val laufendeFassung: AppFassung

    /** Die signierte Beschreibung, roh und höchstens [UPDATE_JSON_MAX_BYTES]; wirft bei einem Netzfehler. */
    suspend fun holeBeschreibung(): String

    /**
     * Lädt das APK nach [ziel] und meldet den Fortschritt in Prozent, nur bei Änderung.
     * Ein Abbruch oder Fehler löscht die Teildatei; ein halbes APK soll nicht liegen bleiben.
     */
    fun ladeApk(beschreibung: UpdateBeschreibung, ziel: File): Flow<Int>
}

/** Über den blanken Update-Client; beide Abrufe gehen durch [abrufen]. */
class UpdateLader @Inject constructor(
    @param:UpdateClient private val client: OkHttpClient,
    override val laufendeFassung: AppFassung,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : UpdateRepository {

    override suspend fun holeBeschreibung(): String = withContext(io) {
        abrufen(UPDATE_VERSION_URL).use { antwort ->
            // peekBody liest höchstens so viel: Eine manipulierte Antwort soll die App nicht
            // umbringen, ohne je ein APK anfassen zu müssen.
            antwort.peekBody(UPDATE_JSON_MAX_BYTES).string()
        }
    }

    override fun ladeApk(beschreibung: UpdateBeschreibung, ziel: File): Flow<Int> = flow {
        try {
            abrufen(beschreibung.apkUrl).use { antwort ->
                // Bevorzugt aus der Beschreibung: Hinter der Umleitung ist contentLength oft -1.
                val gesamt = if (beschreibung.apkSize > 0) beschreibung.apkSize else antwort.body.contentLength()
                val obergrenze =
                    if (gesamt in 1..UPDATE_MAX_BYTES) minOf(gesamt + 1024 * 1024, UPDATE_MAX_BYTES)
                    else UPDATE_MAX_BYTES
                antwort.body.byteStream().use { ein ->
                    ziel.outputStream().use { aus ->
                        val puffer = ByteArray(64 * 1024)
                        var geladen = 0L
                        var zuletzt = -1
                        while (true) {
                            // Ohne diese Prüfung liefe ein verlassener Download weiter bis zum Ende.
                            currentCoroutineContext().ensureActive()
                            val n = ein.read(puffer)
                            if (n < 0) break
                            geladen += n
                            // Abbrechen, BEVOR geschrieben wird: Sonst liegt das Zuviel schon auf der Platte.
                            if (geladen > obergrenze) throw IOException("Update groesser als erlaubt ($geladen > $obergrenze)")
                            aus.write(puffer, 0, n)
                            val p = if (gesamt > 0) ((geladen * 100) / gesamt).toInt().coerceIn(0, 100) else zuletzt
                            if (p != zuletzt) {
                                zuletzt = p
                                emit(p)
                            }
                        }
                    }
                }
            }
        } catch (e: CancellationException) {
            ziel.delete()
            throw e
        } catch (e: IOException) {
            ziel.delete()
            throw e
        }
    }.flowOn(io)

    /**
     * Die eine Stelle, an der die Selbstaktualisierung ins Netz geht: Eine Prüfung der
     * Antwort (Status, Umleitungsziel) trifft so Beschreibung und APK gleichermassen.
     */
    private fun abrufen(adresse: String): Response {
        val antwort = client.newCall(Request.Builder().url(adresse).build()).execute()
        if (!antwort.isSuccessful) {
            antwort.close()
            throw IOException("HTTP ${antwort.code}")
        }
        return antwort
    }
}
