package ch.brickinventoryapp.data

import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.netz.di.ServerWaechter
import ch.brickinventoryapp.netz.di.Zugangslage
import ch.brickinventoryapp.sicherheit.Tresorbefund
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.ResponseCache

/**
 * Abmelden ohne Netz lässt das Token am Server nicht gültig: Scheitert
 * der kurze Versuch, geht ein Auftrag in die Warteschlange, der wiederholt, bis der
 * Server bestätigt. Der Arbeiter selbst (WorkManager) läuft nur auf dem Gerät;
 * geprüft werden Abmeldung, Entwerter und die Entscheidung je Lauf.
 *
 * Gegenproben:
 *   A  Abmeldung.amServer() ohne planer.plane() → rot „scheitert der Versuch, geht
 *      ein Auftrag in die Warteschlange“
 *   B  einordnenEntwertung(): 401 als SPAETER → rot „ein Token, das schon nicht
 *      mehr gilt, braucht keinen Auftrag“ und „der Entwerter …“ (401-Fall)
 *   C  Entwerter ohne eigenen Wächter (basis unverändert) → rot „der Entwerter
 *      schickt genau dieses Token …“ (kein Authorization-Kopf)
 *   D  entwertungsSchritt(): Gesperrt → AUFGEGEBEN → rot „ein gesperrter Keystore
 *      wartet …“
 *   E in entwerte() die Prüfung der Herkunft entfernt → rot
 *      „ein Auftrag für einen anderen Server schickt nichts“ (gegenproben/entwerter-ohne-herkunft.patch)
 *   F  entwertungsSchritt(): Gesperrt gibt auch bei gesperrtem Gerät nach den Höchstversuchen
 *      auf (`!geraetGesperrt &&` entfernt) → rot „bei gesperrtem Geraet gibt der Auftrag nicht auf“
 *      (gegenproben/entwertung-gibt-bei-sperre-auf.patch; nur CI)
 */
class EntwertungTest {

    private val server = MockWebServer().apply { start() }
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-ew-${System.nanoTime()}")

    @After
    fun zu() {
        runCatching { server.shutdown() }
        dir.deleteRecursively()
    }

    private fun konto(): KontoRepository {
        val lage = object : Zugangslage {
            override fun serverUrl() = server.url("/").toString().trimEnd('/')
            override fun token() = "geheim"
            override fun tokenHerkunft(): String? = NetworkPolicy.herkunft(serverUrl())
            override fun generation() = 0L
        }
        val client = OkHttpClient.Builder()
            .addInterceptor(ServerWaechter(lage, true, entwicklung = true, sitzungAbgelaufen = {}))
            .readTimeout(2, TimeUnit.SECONDS).build()
        return KontoRepository(Retrofit.Builder().baseUrl(server.url("/")).client(client)
            .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
            .build().create(KontoApi::class.java), ResponseCache { dir })
    }

    private val auftrag = Entwertungsauftrag("https://brick.example", "GEHEIMTEXT")

    private fun abmelden(): Pair<Abmeldeweg, List<Entwertungsauftrag>> {
        val geplant = mutableListOf<Entwertungsauftrag>()
        val weg = runBlocking { Abmeldung(konto(), { auftrag }, { geplant += it }).amServer() }
        return weg to geplant
    }

    @Test
    fun `gelingt der Versuch, bleibt die Warteschlange leer`() {
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertEquals(Abmeldeweg.SOFORT to emptyList<Entwertungsauftrag>(), abmelden())
    }

    @Test
    fun `scheitert der Versuch, geht ein Auftrag in die Warteschlange`() {
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(Abmeldeweg.NACHGEHOLT to listOf(auftrag), abmelden())
        server.shutdown()
        assertEquals("Ohne Server ebenso", Abmeldeweg.NACHGEHOLT to listOf(auftrag), abmelden())
    }

    @Test
    fun `ein Token, das schon nicht mehr gilt, braucht keinen Auftrag`() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"x"}"""))
        assertEquals(Abmeldeweg.SOFORT to emptyList<Entwertungsauftrag>(), abmelden())
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals("Ein Server ohne Abmelde-Endpunkt wird es nie haben",
            Abmeldeweg.OHNE_AUFTRAG to emptyList<Entwertungsauftrag>(), abmelden())
    }

    @Test
    fun `der Entwerter schickt genau dieses Token an genau diesen Server`() {
        val entwerter = Entwerter(OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build(), entwicklung = true)
        val basis = server.url("/brick").toString().trimEnd('/')
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertEquals(Entwertungsergebnis.ENTWERTET, entwerter.entwerte(basis, "altes-token"))
        val a = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("POST", a.method)
        assertEquals("/brick/api/v1/auth/logout", a.path)
        assertEquals("Bearer altes-token", a.getHeader("Authorization"))

        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals(Entwertungsergebnis.ENTWERTET, entwerter.entwerte(basis, "altes-token"))
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(Entwertungsergebnis.SPAETER, entwerter.entwerte(basis, "altes-token"))
        server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", "/andere-app/fang"))
        assertEquals("Aus dem Pfad hinaus folgt er nicht", Entwertungsergebnis.AUFGEBEN, entwerter.entwerte(basis, "altes-token"))
        server.takeRequest(1, TimeUnit.SECONDS); server.takeRequest(1, TimeUnit.SECONDS); server.takeRequest(1, TimeUnit.SECONDS)
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))

        val klartext = Entwerter(OkHttpClient(), entwicklung = false)
        assertEquals("Kein Token im Klartext, auch nicht später", Entwertungsergebnis.AUFGEBEN, klartext.entwerte(basis, "t"))
        server.shutdown()
        assertEquals(Entwertungsergebnis.SPAETER, entwerter.entwerte(basis, "altes-token"))
    }

    @Test
    fun `ein Auftrag fuer einen anderen Server schickt nichts`() {
        val entwerter = Entwerter(OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build(), entwicklung = true)
        val b = server.url("/").toString().trimEnd('/')
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(Entwertungsergebnis.AUFGEBEN, entwerter.entwerte(b, "token-von-a", herkunft = "https://a.example"))
        assertEquals(Entwertungsergebnis.AUFGEBEN, entwerter.entwerte(b, "token-von-a", herkunft = null))
        assertEquals("Das Token von A ging an B", 0, server.requestCount)
        assertEquals("Ohne Angabe gehört das Token dem Server des Auftrags",
            NetworkPolicy.herkunft(b), Entwertungsauftrag(b, "x").herkunft)
    }

    @Test
    fun `ein gesperrter Keystore wartet, ein verlorener Schluessel beendet den Auftrag`() {
        var gerufen = 0
        val entwerte = { _: String -> gerufen++; Entwertungsergebnis.SPAETER }
        assertEquals(Entwertungsschritt.NOCHMAL, entwertungsSchritt(Tresorbefund.Gesperrt, 0, entwerte = entwerte))
        assertEquals(Entwertungsschritt.AUFGEGEBEN, entwertungsSchritt(Tresorbefund.Weg, 0, entwerte = entwerte))
        assertEquals("Ohne Token kein Aufruf", 0, gerufen)
        assertEquals(Entwertungsschritt.NOCHMAL, entwertungsSchritt(Tresorbefund.Lesbar("t"), 0, entwerte = entwerte))
        assertEquals(Entwertungsschritt.AUFGEGEBEN,
            entwertungsSchritt(Tresorbefund.Lesbar("t"), ENTWERTUNG_HOECHSTVERSUCHE - 1, entwerte = entwerte))
        assertEquals(Entwertungsschritt.FERTIG,
            entwertungsSchritt(Tresorbefund.Lesbar("t"), 3) { Entwertungsergebnis.ENTWERTET })
        assertTrue(ENTWERTUNG_HOECHSTVERSUCHE >= 10)
    }

    /** Der Schlüssel des Tokens arbeitet nur entsperrt: Tagelang gesperrt ist kein Fehlschlag. */
    @Test
    fun `bei gesperrtem Geraet gibt der Auftrag nicht auf`() {
        val letzter = ENTWERTUNG_HOECHSTVERSUCHE - 1
        val entwerte = { _: String -> Entwertungsergebnis.SPAETER }
        assertEquals(Entwertungsschritt.NOCHMAL,
            entwertungsSchritt(Tresorbefund.Gesperrt, letzter, geraetGesperrt = true, entwerte = entwerte))
        assertEquals(Entwertungsschritt.NOCHMAL,
            entwertungsSchritt(Tresorbefund.Gesperrt, letzter * 3, geraetGesperrt = true, entwerte = entwerte))
        assertEquals("Entsperrt und weiter gesperrt: ein anderer Fehler, der aufgibt", Entwertungsschritt.AUFGEGEBEN,
            entwertungsSchritt(Tresorbefund.Gesperrt, letzter, geraetGesperrt = false, entwerte = entwerte))
    }
}
