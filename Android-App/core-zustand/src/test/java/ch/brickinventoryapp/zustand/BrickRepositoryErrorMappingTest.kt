package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.testing.BrickApiService
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.test.runTest
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
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.netz.di.ServerWaechter
import ch.brickinventoryapp.netz.di.Zugangslage
import ch.brickinventoryapp.testing.KontoRepository

/**
 * Der erste Test in diesem Projekt, der VERHALTEN ausführt statt Quelltext zu
 * lesen.
 *
 * ── Warum das bisher nicht ging ──────────────────────────────
 *
 * `testImplementation(libs.junit)` war die einzige Testabhängigkeit. Ohne
 * Testbibliothek für Koroutinen und ohne HTTP-Attrappe blieb nur, den
 * Quelltext nach Mustern abzusuchen — daher lasen 41 von 47 Testdateien Text.
 *
 * Hier läuft jetzt ein echter HTTP-Server im Test, und geprüft wird die
 * Abbildung: Was macht das Repository aus
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
    private lateinit var repo: KontoRepository
    private lateinit var cacheDir: File

    /** Kurze Fristen: Der Zeitüberschreitungs-Fall soll den Lauf nicht bremsen. */
    private fun baueRepo(leseFristMs: Long = 1_000, waechter: okhttp3.Interceptor? = null): KontoRepository {
        val client = OkHttpClient.Builder()
            .apply { waechter?.let { addInterceptor(it) } }
            .readTimeout(leseFristMs, TimeUnit.MILLISECONDS)
            .connectTimeout(leseFristMs, TimeUnit.MILLISECONDS)
            .build()
        // Dieselbe Json-Konfiguration wie in di/AppModule — sonst prüfte der
        // Test eine Nachsicht, die es in der App nicht gibt.
        val json = BrickJson
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BrickApiService::class.java)
        // KontoRepository statt BrickRepository: getMe() liegt
        // seit der Aufteilung dort. Geprueft wird hier die Fehlerumsetzung in
        // safeCall() — die steht in Abruf.kt und ist fuer alle fuenf
        // Teil-Repositories dieselbe; getMe ist nur das Vehikel.
        return KontoRepository(api)
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

    private fun fehler(r: Ergebnis<*>): Ergebnis.Error {
        assert(r is Ergebnis.Error) { "Erwartet wurde ein Fehler, kam aber: $r" }
        return r as Ergebnis.Error
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
        assert(e == Ergebnis.Error.Server(409, "Für dieses Datum gibt es schon einen Kaufpreis")) {
            "Bei vorhandener Servermeldung bleibt es ein Serverfehler mit ihrem Satz, war: $e"
        }
    }

    @Test
    fun `Fehlercode ohne Rumpf wird als Serverfehler eingeordnet`() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody(""))
        val e = fehler(repo.getMe())
        assert(e is Ergebnis.Error.Server && e.status == 500) { "Art war $e" }
        assert(e.message.isBlank()) {
            "Die Datenschicht darf keinen Satz bauen, tat es aber: '${e.message}'"
        }
    }

    @Test
    fun `401 wird als abgelaufene Sitzung gemeldet und nicht als transient`() = runTest {
        // Die Unterscheidung ist der Grund für eine eigene Art: Ein
        // Wiederholen behebt einen 401 nie, und cached() darf ihn nicht mit
        // einer alten Antwort von der Platte überdecken.
        server.enqueue(MockResponse().setResponseCode(401).setBody(""))
        val e = fehler(repo.getMe())
        assert(e is Ergebnis.Error.Abgewiesen) { "Art war $e" }
        assert(!e.transient) { "401 darf nicht als vorübergehend gelten" }
    }

    @Test
    fun `Zeitueberschreitung ist voruebergehend`() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val e = fehler(baueRepo(leseFristMs = 300).getMe())
        assert(e.transient) { "Zeitüberschreitung muss als vorübergehend gelten" }
        assert(e == Ergebnis.Error.Zeitueberschreitung) { "Art war $e" }
    }

    @Test
    fun `abgerissene Verbindung ist ein Netzfehler und voruebergehend`() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        val e = fehler(repo.getMe())
        assert(e is Ergebnis.Error.Netz && e.transient) { "Abriss muss als vorübergehend gelten, war: $e" }
        assert(e.message.isBlank()) { "Kein Satz aus der Datenschicht, war: '${e.message}'" }
    }

    /**
     * Eine gespeicherte http-Adresse: Der Wächter des Release-Builds lehnt ab, und
     * daraus wird ein eigener Satz mit Anleitung statt „keine Verbindung“.
     * Gegenprobe: den Zweig für KlartextAbgelehnt in
     * sicherAufrufen() entfernt → rot (Netz, vorübergehend).
     */
    @Test
    fun `eine abgelehnte http-Anfrage ist kein Netzfehler und nicht voruebergehend`() = runTest {
        val lage = object : Zugangslage {
            override fun serverUrl() = server.url("/").toString()
            override fun token() = "geheim"
            override fun tokenHerkunft(): String? = NetworkPolicy.herkunft(serverUrl())
            override fun generation() = 0L
        }
        val waechter = ServerWaechter(lage, false, entwicklung = false, sitzungAbgelaufen = {})
        val e = fehler(baueRepo(waechter = waechter).getMe())
        assert(e == Ergebnis.Error.Klartext) { "Art war $e" }
        assert(!e.transient) { "Ein zweiter Versuch ginge genauso an http" }
        assert(server.requestCount == 0) { "Die Anfrage ging trotzdem hinaus" }
    }

    @Test
    fun `eine gueltige Antwort ist ein Erfolg`() = runTest {
        // Gegenprobe zu allen Fehlerfällen: Ohne sie könnte die Abbildung auch
        // dann grün sein, wenn schlicht ALLES als Fehler endet.
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setBody("""{"success":true,"user":{"id":1,"username":"marco"}}""")
        )
        // `when` statt Cast: Ergebnis hat genau zwei Varianten, also ist es
        // erschöpfend — und der Smart Cast im Zweig liefert den Typ mit.
        when (val r = repo.getMe()) {
            is Ergebnis.Success -> assert(r.data.success) { "success war false" }
            is Ergebnis.Error   -> assert(false) { "Erwartet wurde Erfolg, kam: $r" }
        }
    }
}
