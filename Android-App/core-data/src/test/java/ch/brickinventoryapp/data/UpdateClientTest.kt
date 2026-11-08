package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.di.NetzModule
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Der Client der Selbstaktualisierung, wie Hilt ihn baut: Er geht zu GitHub, nicht zu
 * unserem Server, und trägt darum weder Token noch Sprache; Umleitungen folgt nur der
 * eigene Wächter (UpdateUmleitungTest), OkHttp selbst keiner, auch nicht von https
 * auf http. Was hinausginge, fängt ein angehängter Interceptor vor dem Netz ab.
 *
 * Gegenproben (Patches unter gegenproben/, lokal mit kotlinc gemessen):
 *   update-client-mit-token       ein Interceptor setzt Authorization → rot „der Update-Client …“
 *   update-client-folgt-http      followSslRedirects(true) → rot „der Update-Client …“
 */
class UpdateClientTest {

    @Test
    fun `der Update-Client traegt nichts von unserem Server und folgt keiner Umleitung selbst`() {
        val client = NetzModule.provideUpdateOkHttpClient()
        assertFalse("OkHttp folgt Umleitungen am Wächter vorbei", client.followRedirects)
        assertFalse("OkHttp folgt einer Umleitung von https auf http", client.followSslRedirects)
        assertNull("Ein APK im Zwischenspeicher verdrängte die Vorschauen", client.cache)
        assertTrue(client.networkInterceptors.isEmpty())

        var hinaus: Request? = null
        val abgefangen = client.newBuilder().addInterceptor { kette ->
            hinaus = kette.request()
            Response.Builder().request(kette.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body("{}".toResponseBody("application/json".toMediaType())).build()
        }.build()
        abgefangen.newCall(Request.Builder().url("https://github.com/x/y/releases/download/a/version.json").build())
            .execute().close()

        val kopf = hinaus!!.headers
        assertEquals("Köpfe zu GitHub: ${kopf.names()}", emptySet<String>(), kopf.names())
    }
}
