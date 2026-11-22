package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.di.NetworkModule
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
 * Counter-checks (patches under counter-checks/, measured locally with kotlinc):
 *   update-client-with-token       an interceptor sets Authorization → red “the update client …”
 *   update-client-follows-http      followSslRedirects(true) → red “the update client …”
 */
class UpdateClientTest {

    @Test
    fun `the update client carries nothing from our server and follows no redirect itself`() {
        val client = NetworkModule.provideUpdateOkHttpClient()
        assertFalse("OkHttp follows redirects past the guard", client.followRedirects)
        assertFalse("OkHttp follows a redirect from https to http", client.followSslRedirects)
        assertNull("An APK in the cache displaced the previews", client.cache)
        assertTrue(client.networkInterceptors.isEmpty())

        var beyond: Request? = null
        val intercepted = client.newBuilder().addInterceptor { chain ->
            beyond = chain.request()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body("{}".toResponseBody("application/json".toMediaType())).build()
        }.build()
        intercepted.newCall(Request.Builder().url("https://github.com/x/y/releases/download/a/version.json").build())
            .execute().close()

        val header = beyond!!.headers
        assertEquals("Headers to GitHub: ${header.names()}", emptySet<String>(), header.names())
    }
}
