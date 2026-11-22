package ch.brickinventoryapp.state

import ch.brickinventoryapp.network.di.AccessState
import ch.brickinventoryapp.network.di.ServerGuard
import ch.brickinventoryapp.network.util.APP_API_VERSION
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.network.util.PlaintextRejected
import ch.brickinventoryapp.network.util.VersionsHint
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.util.Collections
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The guard for all requests to the app's own server, run against a
 * test server over http on localhost. Only the debug build may do that; the tests of the
 * rules for tokens and headers therefore run with `development = true`, the tests of the
 * plaintext ban with both values.
 *
 * Counter-checks (measured 29.10.2026, kotlinc against network/di/ServerGuard.kt):
 *   B  `tokenBelongsHere` always true → red „der Token geht nur an den Server,
 *      der ihn ausgab“ and „ein selbst gesetzter Kopf …“
 *   C  `ourServer` without isSameOrigin (only serverUrl.isNotBlank()) → red
 *      „a foreign host gets neither token nor language“
 *   D  the retry removed → red „a request without a token reaches for the new one“
 *   E  the 401 report without `tokenSentAlong` → red „ein 401 ohne Token meldet
 *      nicht ab“ and „the token goes only to the server that issued it“
 *   F  the server's path left out while rewriting the placeholder → red „der Platzhalter
 *      wird auf den Server samt Pfad umgeschrieben“
 *   G  ownHeaders() not called → red „der eigene Server bekommt Sprache
 *      und Fassung“
 *   I  the check connectionAllowed() removed in the guard → red
 *      „im Release-Build erreicht keine http-Anfrage den Server …“ and „auch der
 *      Debug-Build schickt http nur …“
 *   K  in the guard `development` fixed to true → red „im
 *      Release-Build erreicht keine http-Anfrage den Server …“
 *   H  /settings/theme excluded from the token (`withToken` false for
 *      paths at "/settings/theme") → red „the account's design is fetched with the token“
 *   J  in the guard the report via versionsHint() removed → red „ein
 *      Server mit hoeherer Mindestfassung meldet App zu alt …“ (empty list instead of APP_TOO_OLD)
 *   L  rightsRevoked() on every 403 → red „ein 403 only_admins …“
 *   M  CONFIRMATION_NEEDED not honored (every 401 signs out) →
 *      red „eine falsche Passwortbestaetigung meldet nicht ab“
 *   N  in the guard the line for PASSWORD_SWITCH_NEEDED removed →
 *      red „ein 403 password_switch_needed verlangt das neue Passwort …“
 *   O  the old rule restored (a self-set header is only removed if it
 *      is the current token) → red „ein selbst gesetzter Kopf mit einem aelteren
 *      Token …“ and „nach dem Abmelden geht kein selbst gesetzter Kopf hinaus …“
 *   P  only `!tokenBelongsHere` instead of `!withToken` → red „nach dem Abmelden …“
 *   R  `origin == null ||` restored in tokenBelongsHere →
 *      red „a token without binding goes to no server“ (counter-checks/token-ohne-bindung-gesendet.patch)
 *   Q  counter-checks/waechter-ohne-faktorpflicht.patch removes
 *      the line for SECOND_FACTOR_REQUIRED → red „ein 403 second_factor_required …“
 */
class ServerGuardTest {

    private val server = MockWebServer()
    private val requests = Collections.synchronizedList(mutableListOf<Pair<String, String?>>())
    private val codes = Collections.synchronizedMap(mutableMapOf<String, Int>())
    private val expired = AtomicInteger()
    private val revoked = AtomicInteger()
    private val switch = AtomicInteger()
    private val factor = AtomicInteger()
    /** Body per path for responses with an error code. */
    private val bodies = Collections.synchronizedMap(mutableMapOf<String, String>())

    private inner class State(
        var url: String,
        var tokens: ArrayDeque<String> = ArrayDeque(listOf(TOKEN)),
        var origin: String? = null,
        /** false: a token from older versions without binding. */
        val bound: Boolean = true,
    ) : AccessState {
        override fun serverUrl() = url
        override fun token(): String = if (tokens.size > 1) tokens.removeFirst() else tokens.first()
        override fun tokenOrigin() = if (bound) origin ?: NetworkPolicy.origin(url) else null
        override fun generation() = 0L
    }

    @Before
    fun setUp() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                requests += path to request.getHeader("Authorization")
                return MockResponse().setResponseCode(codes[path.substringBefore('?')] ?: 200)
                    .setBody(bodies[path.substringBefore('?')] ?: """{"success":true}""")
            }
        }
        server.start()
    }

    @After
    fun tearDown() = server.shutdown()

    private fun basis() = server.url("/").toString().trimEnd('/')

    private fun client(situation: AccessState, api: Boolean = true, development: Boolean = true) = OkHttpClient.Builder()
        .addInterceptor(ServerGuard(situation, api, development, sessionExpired = { expired.incrementAndGet() },
            ownHeaders = { _, target -> target.header("Accept-Language", "de") }, rightsRevoked = { revoked.incrementAndGet() },
            passwordSwitchNeeded = { switch.incrementAndGet() }, secondFactorRequired = { factor.incrementAndGet() }))
        .readTimeout(2, TimeUnit.SECONDS).build()

    private fun fetch(c: OkHttpClient, url: String): Int =
        c.newCall(Request.Builder().url(url).build()).execute().use { it.code }

    private fun requestsTo(part: String) = synchronized(requests) { requests.filter { part in it.first } }

    @Test
    fun `a token without binding goes to no server`() {
        codes["/api/v1/sets"] = 401
        val c = client(State(basis(), bound = false))
        assertEquals(401, fetch(c, "http://localhost:3000/api/v1/sets"))
        c.newCall(Request.Builder().url(basis() + "/api/v1/pdf").header("Authorization", "Bearer $TOKEN").build())
            .execute().close()
        assertEquals("Ein ungebundener Token ging hinaus", listOf<String?>(null, null),
            synchronized(requests) { requests.map { it.second } })
        assertEquals("Ohne Token meldet ein 401 nicht ab", 0, expired.get())
    }

    @Test
    fun `a 401 on the token reports the expired session`() {
        codes["/api/v1/sets"] = 401
        val c = client(State(basis()))
        assertEquals(401, fetch(c, "http://localhost:3000/api/v1/sets"))
        assertEquals("Bearer $TOKEN", requestsTo("/api/v1/sets").single().second)
        assertEquals(1, expired.get())
    }

    @Test
    fun `the image client also attaches the token and reports a 401`() {
        codes["/images/sets/1.jpg"] = 401
        fetch(client(State(basis()), api = false), basis() + "/images/sets/1.jpg")
        assertEquals("Bearer $TOKEN", requestsTo("/images/").single().second)
        assertEquals(1, expired.get())
    }

    /** Without a token the server returned the default instead of this account's theme. */
    @Test
    fun `the account's design is fetched with the token`() {
        fetch(client(State(basis())), "http://localhost:3000/api/v1/settings/theme")
        assertEquals("Bearer $TOKEN", requestsTo("/api/v1/settings/theme").single().second)
    }

    @Test
    fun `the placeholder is rewritten to the server including path`() {
        fetch(client(State(basis() + "/brick")), "http://localhost:3000/api/v1/sets?seite=2")
        assertEquals("/brick/api/v1/sets?seite=2", requestsTo("/api/v1/sets").single().first)
    }

    @Test
    fun `the token goes only to the server that issued it`() {
        codes["/api/v1/sets"] = 401
        val situation = State(basis(), origin = "http://anderer.example:3000")
        assertEquals(401, fetch(client(situation), "http://localhost:3000/api/v1/sets"))
        assertNull("Der alte Token ging an den neuen Server", requestsTo("/api/v1/sets").single().second)
        assertEquals("Ohne Token ist ein 401 kein Ablauf", 0, expired.get())
    }

    @Test
    fun `a self-set header with the token is dropped for a foreign origin`() {
        val situation = State(basis(), origin = "http://anderer.example:3000")
        client(situation).newCall(Request.Builder().url(basis() + "/api/v1/csv")
            .header("Authorization", "Bearer $TOKEN").build()).execute().close()
        assertNull(requestsTo("/api/v1/csv").single().second)
    }

    /** A swap that outlives the server change carries the old server's token. */
    @Test
    fun `a self-set header with an older token is dropped for a foreign origin`() {
        val situation = State(basis(), origin = "http://anderer.example:3000")
        client(situation).newCall(Request.Builder().url("http://localhost:3000/api/v1/auth/token-rotieren")
            .header("Authorization", "Bearer vom-alten-server").build()).execute().close()
        assertNull(requestsTo("/token-rotieren").single().second)
    }

    @Test
    fun `after sign-out no self-set header goes out, one bound to the own origin does`() {
        client(State(basis(), tokens = ArrayDeque(listOf("")))).newCall(Request.Builder().url(basis() + "/api/v1/csv")
            .header("Authorization", "Bearer alt").build()).execute().close()
        assertNull("Abgemeldet: kein Token", requestsTo("/api/v1/csv").single().second)

        val own = NetworkPolicy.origin(basis())
        client(State(basis(), origin = own)).newCall(Request.Builder().url(basis() + "/api/v1/pdf")
            .header("Authorization", "Bearer alt").build()).execute().close()
        assertEquals("Bearer alt", requestsTo("/api/v1/pdf").single().second)
    }

    @Test
    fun `the own server gets language and version`() {
        fetch(client(State(basis(), tokens = ArrayDeque(listOf(""))), api = false), basis() + "/api/v1/stats")
        val r = server.takeRequest()
        assertEquals("de", r.getHeader("Accept-Language"))
        assertEquals(APP_API_VERSION.toString(), r.getHeader("X-App-Api"))
    }

    @Test
    fun `a server with a higher minimum version reports app too old instead of a read error`() {
        // How the server of an old app answers: 426 together with both versions in the header.
        val newer = (APP_API_VERSION + 1).toString()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setResponseCode(426)
                .setHeader("X-Api-Version", newer).setHeader("X-Api-Min-App", newer)
                .setBody("""{"success":false,"error":"App zu alt","code":"app_zu_alt"}""")
        }
        val hints = Collections.synchronizedList(mutableListOf<VersionsHint>())
        val c = OkHttpClient.Builder()
            .addInterceptor(ServerGuard(State(basis(), tokens = ArrayDeque(listOf(""))), true, true,
                sessionExpired = { expired.incrementAndGet() }, versionsMessage = { hints += it }))
            .readTimeout(2, TimeUnit.SECONDS).build()
        assertEquals(426, fetch(c, basis() + "/api/v1/auth/profile"))
        assertEquals(426, fetch(c, basis() + "/api/v1/sets"))
        assertEquals("einmal gemeldet, nicht je Anfrage", listOf(VersionsHint.APP_TOO_OLD), hints.toList())
        assertEquals(0, expired.get())
    }

    @Test
    fun `a foreign host gets neither token nor language`() {
        // The same test server under its IP is a different host for the guard.
        val foreign = server.url("/bild.jpg").newBuilder().host("127.0.0.1").build().toString()
        fetch(client(State(server.url("/").newBuilder().host("localhost").build().toString()), api = false), foreign)
        val r = server.takeRequest()
        assertNull(r.getHeader("Authorization"))
        assertNull(r.getHeader("Accept-Language"))
        assertNull(r.getHeader("X-App-Api"))
    }

    @Test
    fun `a request without a token reaches for the new one`() {
        // The first read doesn't yet return a token, the second returns the freshly stored one.
        codes["/api/v1/sets"] = 401
        val situation = State(basis(), tokens = ArrayDeque(listOf("", TOKEN)))
        fetch(client(situation), "http://localhost:3000/api/v1/sets")
        val an = requestsTo("/api/v1/sets")
        assertEquals(listOf(null, "Bearer $TOKEN"), an.map { it.second })
        assertEquals("Nach dem Nachfassen ist der 401 echt", 1, expired.get())
    }

    @Test
    fun `a 401 without a token does not sign out`() {
        codes["/api/v1/auth/login"] = 401
        val situation = State(basis(), tokens = ArrayDeque(listOf("")))
        assertEquals(401, fetch(client(situation), "http://localhost:3000/api/v1/auth/login"))
        assertEquals(0, expired.get())
    }

    /** The release build's rule: no http, not even to the device itself. */
    @Test
    fun `in the release build no http request reaches the server, not even localhost`() {
        val c = client(State(basis()), development = false)
        for (url in listOf("http://localhost:3000/api/v1/sets", basis() + "/images/sets/1.jpg")) {
            try {
                fetch(c, url)
                fail("$url darf nicht hinausgehen")
            } catch (e: PlaintextRejected) {
                assertEquals(server.url("/").host, e.host)
            }
        }
        assertEquals("Weder Token noch Anfrage gingen hinaus", 0, server.requestCount)
        assertEquals(0, expired.get())
    }

    /** The debug build may use http only for the three hosts of its network security config. */
    @Test
    fun `the debug build also sends http only to the device and the emulator host`() {
        for (address in listOf("http://nas:3000", "http://192.168.1.50:3000", "http://brick.example.org")) {
            try {
                fetch(client(State(address)), "http://localhost:3000/api/v1/sets")
                fail("$address darf nicht im Klartext erreicht werden")
            } catch (_: PlaintextRejected) { }
        }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `a 403 only_admins on a token reports the revocation of rights, another 403 does not`() {
        codes["/api/v1/admin/jobs"] = 403
        bodies["/api/v1/admin/jobs"] = """{"success":false,"code":"nur_admins","error":"Nur für Admins"}"""
        codes["/api/v1/auth/passkey/registrieren/optionen"] = 403
        bodies["/api/v1/auth/passkey/registrieren/optionen"] = """{"success":false,"code":"nur_mit_sitzung"}"""
        val c = client(State(basis()))
        assertEquals(403, fetch(c, "http://localhost:3000/api/v1/admin/jobs"))
        assertEquals(403, fetch(c, "http://localhost:3000/api/v1/auth/passkey/registrieren/optionen"))
        assertEquals(1, revoked.get())
        assertEquals("Ein 403 ist keine abgelaufene Sitzung", 0, expired.get())

        fetch(client(State(basis(), tokens = ArrayDeque(listOf("")))), "http://localhost:3000/api/v1/admin/jobs")
        assertEquals("Ohne Token sagt ein 403 nichts über dieses Konto", 1, revoked.get())
    }

    @Test
    fun `a 403 password_switch_needed requires the new password without signing out`() {
        codes["/api/v1/sets"] = 403
        bodies["/api/v1/sets"] = """{"success":false,"code":"passwort_wechsel_noetig","error":"Bitte zuerst das Startpasswort ändern."}"""
        codes["/api/v1/admin/jobs"] = 403
        bodies["/api/v1/admin/jobs"] = """{"success":false,"code":"nur_admins"}"""
        val c = client(State(basis()))
        assertEquals(403, fetch(c, "http://localhost:3000/api/v1/sets"))
        assertEquals(1, switch.get())
        fetch(c, "http://localhost:3000/api/v1/admin/jobs")
        assertEquals("Ein anderes 403 verlangt keinen Wechsel", 1, switch.get())
        assertEquals("Kein Abmelden", 0, expired.get())
    }

    @Test
    fun `a 403 second_factor_required requires the setup without signing out`() {
        codes["/api/v1/sets"] = 403
        bodies["/api/v1/sets"] = """{"success":false,"code":"zweiter_faktor_pflicht","error":"Bitte zuerst einen Code-Generator einrichten."}"""
        codes["/api/v1/admin/jobs"] = 403
        bodies["/api/v1/admin/jobs"] = """{"success":false,"code":"passwort_wechsel_noetig"}"""
        val c = client(State(basis()))
        assertEquals(403, fetch(c, "http://localhost:3000/api/v1/sets"))
        assertEquals(1, factor.get())
        fetch(c, "http://localhost:3000/api/v1/admin/jobs")
        assertEquals("Ein anderes 403 verlangt keinen zweiten Faktor", 1, factor.get())
        assertEquals("Kein Abmelden", 0, expired.get())
        assertEquals("Kein entzogenes Recht", 0, revoked.get())

        fetch(client(State(basis(), tokens = ArrayDeque(listOf("")))), "http://localhost:3000/api/v1/sets")
        assertEquals("Ohne Token sagt ein 403 nichts über dieses Konto", 1, factor.get())
    }

    @Test
    fun `a wrong password confirmation does not sign out, an invalid token does`() {
        codes["/api/v1/auth/zweiter-faktor/abschalten"] = 401
        bodies["/api/v1/auth/zweiter-faktor/abschalten"] = """{"success":false,"code":"aktuelles_passwort_falsch"}"""
        codes["/api/v1/sets"] = 401
        bodies["/api/v1/sets"] = """{"success":false,"code":"token_ungueltig"}"""
        val c = client(State(basis()))
        assertEquals(401, fetch(c, "http://localhost:3000/api/v1/auth/zweiter-faktor/abschalten"))
        assertEquals("Die Bestätigung fragt erneut, statt abzumelden", 0, expired.get())
        assertEquals(401, fetch(c, "http://localhost:3000/api/v1/sets"))
        assertEquals(1, expired.get())
    }

    private companion object { const val TOKEN = "geheim-0123" }
}
