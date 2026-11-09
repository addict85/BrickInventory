package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.api.GeraetApi
import ch.brickinventoryapp.data.repository.SchrittbindungImpl
import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.model.schritt.Schrittantwort
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.TestApi
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.Base64

/**
 * Die Bindung des Schrittschutzes an den Server: Nur ein 404 (ein Server ohne
 * Schrittschutz) lässt die App bei der Prüfung im Gerät; jede andere Absage
 * und ein Netzfehler halten den Schritt an. Die Signatur geht als Base64.
 *
 * Gegenprobe (nur in der CI messbar, lokal fehlt das Android-SDK):
 *   A  in challenge() jede Absage und jeden Netzfehler als NichtGebunden → erwartet
 *      rot „eine Absage des Servers haelt an“ und „ohne Netz kein Rueckfall …“;
 *      gegenproben/schrittbindung-absage-als-ungebunden.patch
 */
class SchrittbindungTest {

    private val server = MockWebServer().apply { start() }
    private val ordner = File(System.getProperty("java.io.tmpdir"), "bim-schritt-${System.nanoTime()}").apply { mkdirs() }
    private val api = Retrofit.Builder().baseUrl(server.url("/"))
        .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
        .build().create(GeraetApi::class.java)
    private val bindung = SchrittbindungImpl(api, ResponseCache { ordner })

    @After
    fun zu() {
        server.shutdown()
        ordner.deleteRecursively()
    }

    @Test
    fun `die Challenge des Servers kommt mit ihrer Nachricht an`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":true,"challenge":"c1","nachricht":"BrickInventory-Schritt/1\ngutschein\nc1","gueltig_bis":"2026-11-09T12:00:00Z"}"""))
        val c = bindung.challenge(Schrittaktion.GUTSCHEIN)
        assertEquals(Schrittantwort.Challenge("c1", "BrickInventory-Schritt/1\ngutschein\nc1"), c)
        val anfrage = server.takeRequest()
        assertEquals("/api/v1/geraet/schritt/challenge", anfrage.path)
        assertEquals("""{"aktion":"gutschein"}""", anfrage.body.readUtf8())
    }

    @Test
    fun `eine Absage des Servers haelt an`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":false,"code":"geraeteschluessel_fehlt","error":"Bitte neu anmelden."}""", 403))
        assertEquals(Schrittantwort.Abgelehnt("Bitte neu anmelden."), bindung.challenge(Schrittaktion.VERWALTUNG))
    }

    @Test
    fun `ein Server ohne Schrittschutz laesst die Pruefung im Geraet`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":false,"code":"api_pfad_unbekannt","error":"x"}""", 404))
        assertEquals(Schrittantwort.NichtGebunden, bindung.challenge(Schrittaktion.GUTSCHEIN))
    }

    @Test
    fun `ohne Netz kein Rueckfall auf die Pruefung im Geraet`() = runBlocking {
        server.shutdown()
        assertTrue(bindung.challenge(Schrittaktion.GUTSCHEIN) is Schrittantwort.Abgelehnt)
    }

    @Test
    fun `die Signatur geht als Base64 zum Server`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":true,"aktion":"gutschein","gueltig_bis":"2026-11-09T12:05:00Z"}"""))
        assertEquals(Schrittantwort.Frei, bindung.freigeben("c1", byteArrayOf(1, 2, 3)))
        val rumpf = server.takeRequest().body.readUtf8()
        assertEquals("""{"challenge":"c1","signatur":"${Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3))}"}""", rumpf)
        server.enqueue(TestApi.antwort("""{"success":false,"code":"schritt_signatur_ungueltig","error":"abgelehnt"}""", 400))
        assertEquals(Schrittantwort.Abgelehnt("abgelehnt"), bindung.freigeben("c2", byteArrayOf(4)))
    }
}
