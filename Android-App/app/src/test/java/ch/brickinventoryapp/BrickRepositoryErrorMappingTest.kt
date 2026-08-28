package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Der erste Test in diesem Projekt, der VERHALTEN ausführt statt Quelltext zu
 * lesen.
 *
 * ── Warum das bisher nicht ging (Nachtrag 117) ──────────────────────────────
 *
 * `testImplementation(libs.junit)` war die einzige Testabhängigkeit. Ohne
 * Testbibliothek für Koroutinen und ohne HTTP-Attrappe blieb nur, den
 * Quelltext nach Mustern abzusuchen — daher lasen 41 von 47 Testdateien Text.
 * Das findet, ob eine Regel im Code STEHT, nie, ob sie WIRKT. In Nachtrag 48
 * hat genau das sieben Nachträge lang eine kaputte Vorschau-Erzeugung
 * verdeckt: Der Test prüfte, dass „tmp + rename" im Code steht, und sah nie
 * nach, ob am Ende eine Datei lag.
 *
 * Hier läuft jetzt ein echter HTTP-Server im Test, und geprüft wird die
 * Abbildung, die Nachtrag 116 eingeführt hat: Was macht das Repository aus
 * einer Antwort? Die Gegenprobe dafür ist der Server selbst — antwortet er
 * anders, muss sich das Ergebnis ändern.
 *
 * Zwei Dinge waren dafür nötig und sind der eigentliche Gewinn:
 *  - [ResponseCache] lässt sich mit einem Wegwerf-Verzeichnis bauen statt mit
 *    einem `Context`.
 *  - Die Zuordnung Ursache → Text liegt in `fehlerTextId()` und braucht keinen
 *    `Context` mehr (siehe FehlerTexteTest).
 */
class BrickRepositoryErrorMappingTest {

    private lateinit var server: MockWebServer
    private lateinit var repo: BrickRepository
    private lateinit var cacheDir: File

    /** Kurze Fristen: Der Zeitüberschreitungs-Fall soll den Lauf nicht bremsen. */
    private fun baueRepo(leseFristMs: Long = 1_000): BrickRepository {
        val client = OkHttpClient.Builder()
            .readTimeout(leseFristMs, TimeUnit.MILLISECONDS)
            .connectTimeout(leseFristMs, TimeUnit.MILLISECONDS)
            .build()
        // Dieselbe Json-Konfiguration wie in di/AppModule — sonst prüfte der
        // Test eine Nachsicht, die es in der App nicht gibt.
        val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
            encodeDefaults = true
            coerceInputValues = true
        }
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BrickApiService::class.java)
        return BrickRepository(api, ResponseCache { cacheDir })
    }

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-test-${System.nanoTime()}")
        cacheDir.mkdirs()
        repo = baueRepo()
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    private fun fehler(r: Result<*>): Result.Error {
        assert(r is Result.Error) { "Erwartet wurde ein Fehler, kam aber: $r" }
        return r as Result.Error
    }

    @Test
    fun `Fehlerrumpf des Servers gewinnt gegen die eigene Einordnung`() = runTest {
        // Der Server kennt seine Fälle genauer als jede Aufzählung in der App —
        // und antwortet in der Sprache des Kontos.
        server.enqueue(
            MockResponse().setResponseCode(409)
                .setBody("""{"success":false,"error":"Für dieses Datum gibt es schon einen Kaufpreis"}""")
        )
        val e = fehler(repo.getMe())
        assert(e.message == "Für dieses Datum gibt es schon einen Kaufpreis") {
            "Servermeldung ging verloren: '${e.message}'"
        }
        assert(e.art == null) {
            "Bei vorhandener Servermeldung darf keine eigene Einordnung gesetzt sein, war: ${e.art}"
        }
    }

    @Test
    fun `Fehlercode ohne Rumpf wird als Serverfehler eingeordnet`() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody(""))
        val e = fehler(repo.getMe())
        assert(e.art == Fehlerart.SERVER) { "Art war ${e.art}" }
        assert(e.httpCode == 500) { "httpCode war ${e.httpCode}" }
        assert(e.message.isBlank()) {
            "Die Datenschicht darf keinen Satz bauen, tat es aber: '${e.message}'"
        }
    }

    @Test
    fun `401 wird als abgelaufene Sitzung gemeldet und nicht als transient`() = runTest {
        // Die Unterscheidung ist der Grund, warum es beide Felder gibt: Ein
        // Wiederholen behebt einen 401 nie, und cached() darf ihn nicht mit
        // einer alten Antwort von der Platte überdecken.
        server.enqueue(MockResponse().setResponseCode(401).setBody(""))
        val e = fehler(repo.getMe())
        assert(e.unauthorized) { "unauthorized nicht gesetzt" }
        assert(!e.transient) { "401 darf nicht als vorübergehend gelten" }
        assert(e.art == Fehlerart.SITZUNG_ABGELAUFEN) { "Art war ${e.art}" }
    }

    @Test
    fun `Zeitueberschreitung ist voruebergehend`() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val e = fehler(baueRepo(leseFristMs = 300).getMe())
        assert(e.transient) { "Zeitüberschreitung muss als vorübergehend gelten" }
        assert(e.art == Fehlerart.ZEIT) { "Art war ${e.art}" }
    }

    @Test
    fun `abgerissene Verbindung ist ein Netzfehler und voruebergehend`() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        val e = fehler(repo.getMe())
        assert(e.transient) { "Abriss muss als vorübergehend gelten, war: $e" }
        assert(e.message.isBlank()) { "Kein Satz aus der Datenschicht, war: '${e.message}'" }
    }

    @Test
    fun `eine gueltige Antwort ist ein Erfolg`() = runTest {
        // Gegenprobe zu allen Fehlerfällen: Ohne sie könnte die Abbildung auch
        // dann grün sein, wenn schlicht ALLES als Fehler endet.
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"user":{"id":1,"username":"marco"}}""")
        )
        // `when` statt Cast: Result hat genau zwei Varianten, also ist es
        // erschöpfend — und der Smart Cast im Zweig liefert den Typ mit.
        when (val r = repo.getMe()) {
            is Result.Success -> assert(r.data.success) { "success war false" }
            is Result.Error   -> assert(false) { "Erwartet wurde Erfolg, kam: $r" }
        }
    }
}
