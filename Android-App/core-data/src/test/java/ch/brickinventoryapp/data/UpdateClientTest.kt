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
 * The client of the self-update, as Hilt builds it: it goes to GitHub, not to
 * our server, and therefore carries neither token nor language; redirects are followed only by the
 * own guard (UpdateRedirectTest), by OkHttp itself none, not even from https
 * to http. What would go out is caught by an attached interceptor before the network.
 *
 * Counter-checks (patches under gegenproben/, measured locally with kotlinc):
 *   update-client-mit-token       an interceptor sets Authorization → red “the update client …”
 *   update-client-folgt-http      followSslRedirects(true) → red “the update client …”
 */
class UpdateClientTest {

    @Test
    fun `the update client carries nothing from our server and follows no redirect itself`() {
        val client = NetzModule.provideUpdateOkHttpClient()
        assertFalse("OkHttp folgt Umleitungen am Wächter vorbei", client.followRedirects)
        assertFalse("OkHttp folgt einer Umleitung von https auf http", client.followSslRedirects)
        assertNull("Ein APK im Zwischenspeicher verdrängte die Vorschauen", client.cache)
        assertTrue(client.networkInterceptors.isEmpty())

        var hinaus: Request? = null
        val intercepted = client.newBuilder().addInterceptor { kette ->
            hinaus = kette.request()
            Response.Builder().request(kette.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body("{}".toResponseBody("application/json".toMediaType())).build()
        }.build()
        intercepted.newCall(Request.Builder().url("https://github.com/x/y/releases/download/a/version.json").build())
            .execute().close()

        val kopf = hinaus!!.headers
        assertEquals("Köpfe zu GitHub: ${kopf.names()}", emptySet<String>(), kopf.names())
    }
}
