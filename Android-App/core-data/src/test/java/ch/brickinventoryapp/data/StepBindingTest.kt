package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.api.DeviceApi
import ch.brickinventoryapp.data.repository.StepBindingImpl
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.step.KeyNonce
import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.model.step.StepResponse
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
 *      counter-checks/schrittbindung-absage-als-ungebunden.patch
 *   C  in challenge() a 404 again as NotBound (the former fallback) →
 *      expected red “a 404 on the challenge stops”;
 *      counter-checks/schrittbindung-404-als-ungebunden.patch
 *   B  in depositChain() the certificates encoded with the URL alphabet →
 *      expected red “the chain goes to the server as Base64 per certificate …”;
 *      counter-checks/schrittbindung-kette-base64url.patch
 */
class StepBindingTest {

    private val server = MockWebServer().apply { start() }
    private val api = Retrofit.Builder().baseUrl(server.url("/"))
        .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
        .build().create(DeviceApi::class.java)
    private val binding = StepBindingImpl(api)

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `the server's challenge arrives with its message`() = runBlocking {
        server.enqueue(TestApi.response("""{"success":true,"challenge":"c1","nachricht":"BrickInventory-Schritt/1\ngutschein\nc1","gueltig_bis":"2026-11-09T12:00:00Z"}"""))
        val c = binding.challenge(StepAction.VOUCHER)
        assertEquals(StepResponse.Challenge("c1", "BrickInventory-Schritt/1\ngutschein\nc1"), c)
        val request = server.takeRequest()
        assertEquals("/api/v1/geraet/schritt/challenge", request.path)
        assertEquals("""{"aktion":"gutschein"}""", request.body.readUtf8())
    }

    @Test
    fun `a refusal of the server stops`() = runBlocking {
        server.enqueue(TestApi.response("""{"success":false,"code":"geraeteschluessel_fehlt","error":"Bitte neu anmelden."}""", 403))
        assertEquals(StepResponse.Rejected("Bitte neu anmelden."), binding.challenge(StepAction.ADMIN))
    }

    @Test
    fun `a 404 on the challenge stops`() = runBlocking {
        server.enqueue(TestApi.response("""{"success":false,"code":"api_pfad_unbekannt","error":"x"}""", 404))
        assertEquals(StepResponse.Rejected("x"), binding.challenge(StepAction.VOUCHER))
        assertEquals(StepResponse.NotBound, binding.challenge(StepAction.LOCAL))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `without network no fallback to the check on the device`() = runBlocking {
        server.shutdown()
        assertTrue(binding.challenge(StepAction.VOUCHER) is StepResponse.Rejected)
    }

    @Test
    fun `the signature goes to the server as Base64`() = runBlocking {
        server.enqueue(TestApi.response("""{"success":true,"aktion":"gutschein","gueltig_bis":"2026-11-09T12:05:00Z"}"""))
        assertEquals(StepResponse.Free, binding.release("c1", byteArrayOf(1, 2, 3)))
        val body = server.takeRequest().body.readUtf8()
        assertEquals("""{"challenge":"c1","signatur":"${Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3))}"}""", body)
        server.enqueue(TestApi.response("""{"success":false,"code":"schritt_signatur_ungueltig","error":"abgelehnt"}""", 400))
        assertEquals(StepResponse.Rejected("abgelehnt"), binding.release("c2", byteArrayOf(4)))
    }

    @Test
    fun `the nonce arrives, a 404 and a refusal bring their sentence`() = runBlocking {
        server.enqueue(TestApi.response("""{"success":true,"nonce":"ab_-"}"""))
        assertEquals(KeyNonce.Nonce("ab_-"), binding.keyNonce())
        assertEquals("/api/v1/geraet/schluessel/nonce", server.takeRequest().path)
        server.enqueue(TestApi.response("""{"success":false,"code":"api_pfad_unbekannt","error":"x"}""", 404))
        assertEquals(KeyNonce.Rejected("x"), binding.keyNonce())
        server.enqueue(TestApi.response("""{"success":false,"code":"geraeteschluessel_frist","error":"Bitte neu anmelden."}""", 403))
        assertEquals(KeyNonce.Rejected("Bitte neu anmelden."), binding.keyNonce())
    }

    @Test
    fun `the chain goes to the server as Base64 per certificate`() = runBlocking {
        server.enqueue(TestApi.response("""{"success":true}"""))
        val chain = listOf(byteArrayOf(-5, -1), byteArrayOf(3))
        assertEquals(StepResponse.Free, binding.depositChain(chain))
        val request = server.takeRequest()
        assertEquals("/api/v1/geraet/schluessel", request.path)
        assertEquals("""{"kette":["+/8=","Aw=="]}""", request.body.readUtf8())
        server.enqueue(TestApi.response("""{"success":false,"code":"geraeteschluessel_attestation","error":"nicht bestätigt"}""", 400))
        assertEquals(StepResponse.Rejected("nicht bestätigt"), binding.depositChain(chain))
        server.shutdown()
        assertEquals("Ein Netzfehler ist keine Meldung", StepResponse.Rejected(null), binding.depositChain(chain))
    }
}
