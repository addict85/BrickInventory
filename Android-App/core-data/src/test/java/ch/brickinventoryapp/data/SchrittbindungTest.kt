package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.data.api.DeviceApi
import ch.brickinventoryapp.data.repository.SchrittbindungImpl
import ch.brickinventoryapp.model.step.Schluesselnonce
import ch.brickinventoryapp.model.step.Schrittaktion
import ch.brickinventoryapp.model.step.Schrittantwort
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
import java.util.Base64

/**
 * The binding of the step protection to the server: every refusal, even a 404, and
 * a network error stop the step; only a step without action at the server
 * stays on the device. The signature goes as Base64.
 *
 * Counter-checks (only measurable in CI, locally the Android SDK is missing):
 *   A  in challenge() every refusal and every network error as NotBound → expected
 *      red “a refusal of the server stops” and “without network no fallback …”;
 *      gegenproben/schrittbindung-absage-als-ungebunden.patch
 *   C  in challenge() a 404 again as NotBound (the former fallback) →
 *      expected red “a 404 on the challenge stops”;
 *      gegenproben/schrittbindung-404-als-ungebunden.patch
 *   B  in depositChain() the certificates encoded with the URL alphabet →
 *      expected red “the chain goes to the server as Base64 per certificate …”;
 *      gegenproben/schrittbindung-kette-base64url.patch
 */
class SchrittbindungTest {

    private val server = MockWebServer().apply { start() }
    private val api = Retrofit.Builder().baseUrl(server.url("/"))
        .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
        .build().create(DeviceApi::class.java)
    private val bindung = SchrittbindungImpl(api)

    @After
    fun zu() {
        server.shutdown()
    }

    @Test
    fun `the server's challenge arrives with its message`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":true,"challenge":"c1","nachricht":"BrickInventory-Schritt/1\ngutschein\nc1","gueltig_bis":"2026-11-09T12:00:00Z"}"""))
        val c = bindung.challenge(Schrittaktion.GUTSCHEIN)
        assertEquals(Schrittantwort.Challenge("c1", "BrickInventory-Schritt/1\ngutschein\nc1"), c)
        val anfrage = server.takeRequest()
        assertEquals("/api/v1/geraet/schritt/challenge", anfrage.path)
        assertEquals("""{"aktion":"gutschein"}""", anfrage.body.readUtf8())
    }

    @Test
    fun `a refusal of the server stops`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":false,"code":"geraeteschluessel_fehlt","error":"Bitte neu anmelden."}""", 403))
        assertEquals(Schrittantwort.Rejected("Bitte neu anmelden."), bindung.challenge(Schrittaktion.VERWALTUNG))
    }

    @Test
    fun `a 404 on the challenge stops`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":false,"code":"api_pfad_unbekannt","error":"x"}""", 404))
        assertEquals(Schrittantwort.Rejected("x"), bindung.challenge(Schrittaktion.GUTSCHEIN))
        assertEquals(Schrittantwort.NotBound, bindung.challenge(Schrittaktion.LOKAL))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `without network no fallback to the check on the device`() = runBlocking {
        server.shutdown()
        assertTrue(bindung.challenge(Schrittaktion.GUTSCHEIN) is Schrittantwort.Rejected)
    }

    @Test
    fun `the signature goes to the server as Base64`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":true,"aktion":"gutschein","gueltig_bis":"2026-11-09T12:05:00Z"}"""))
        assertEquals(Schrittantwort.Free, bindung.freigeben("c1", byteArrayOf(1, 2, 3)))
        val rumpf = server.takeRequest().body.readUtf8()
        assertEquals("""{"challenge":"c1","signatur":"${Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3))}"}""", rumpf)
        server.enqueue(TestApi.antwort("""{"success":false,"code":"schritt_signatur_ungueltig","error":"abgelehnt"}""", 400))
        assertEquals(Schrittantwort.Rejected("abgelehnt"), bindung.freigeben("c2", byteArrayOf(4)))
    }

    @Test
    fun `the nonce arrives, a 404 and a refusal bring their sentence`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":true,"nonce":"ab_-"}"""))
        assertEquals(Schluesselnonce.Nonce("ab_-"), bindung.schluesselNonce())
        assertEquals("/api/v1/geraet/schluessel/nonce", server.takeRequest().path)
        server.enqueue(TestApi.antwort("""{"success":false,"code":"api_pfad_unbekannt","error":"x"}""", 404))
        assertEquals(Schluesselnonce.Rejected("x"), bindung.schluesselNonce())
        server.enqueue(TestApi.antwort("""{"success":false,"code":"geraeteschluessel_frist","error":"Bitte neu anmelden."}""", 403))
        assertEquals(Schluesselnonce.Rejected("Bitte neu anmelden."), bindung.schluesselNonce())
    }

    @Test
    fun `the chain goes to the server as Base64 per certificate`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":true}"""))
        val kette = listOf(byteArrayOf(-5, -1), byteArrayOf(3))
        assertEquals(Schrittantwort.Free, bindung.depositChain(kette))
        val anfrage = server.takeRequest()
        assertEquals("/api/v1/geraet/schluessel", anfrage.path)
        assertEquals("""{"kette":["+/8=","Aw=="]}""", anfrage.body.readUtf8())
        server.enqueue(TestApi.antwort("""{"success":false,"code":"geraeteschluessel_attestation","error":"nicht bestätigt"}""", 400))
        assertEquals(Schrittantwort.Rejected("nicht bestätigt"), bindung.depositChain(kette))
        server.shutdown()
        assertEquals("Ein Netzfehler ist keine Meldung", Schrittantwort.Rejected(null), bindung.depositChain(kette))
    }
}
