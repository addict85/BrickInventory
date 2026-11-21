package ch.brickinventoryapp.state

import ch.brickinventoryapp.network.di.ServerWaechter
import ch.brickinventoryapp.network.di.Zugangslage
import ch.brickinventoryapp.network.util.PlaintextRejected
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
import ch.brickinventoryapp.network.util.APP_API_VERSION
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.network.util.VersionsHint

/**
 * Der Wächter aller Anfragen an den eigenen Server, ausgeführt gegen einen
 * Testserver über http auf localhost. Das darf nur der Debug-Build; die Tests der
 * Regeln für Token und Köpfe laufen darum mit `entwicklung = true`, die Tests des
 * Klartext-Verbots mit beiden Werten.
 *
 * Gegenproben (am 29.10.2026 gemessen, kotlinc gegen network/di/ServerWaechter.kt):
 *   B  `tokenBelongsHere` immer true → rot „der Token geht nur an den Server,
 *      der ihn ausgab“ und „ein selbst gesetzter Kopf …“
 *   C  `ourServer` ohne isSameOrigin (nur serverUrl.isNotBlank()) → rot
 *      „a foreign host gets neither token nor language“
 *   D  das Nachfassen entfernt → rot „a request without a token reaches for the new one“
 *   E  die 401-Meldung ohne `tokenSentAlong` → rot „ein 401 ohne Token meldet
 *      nicht ab“ und „the token goes only to the server that issued it“
 *   F  den Pfad des Servers beim Umschreiben weggelassen → rot „der Platzhalter
 *      wird auf den Server samt Pfad umgeschrieben“
 *   G  ownHeaders() nicht aufgerufen → rot „der eigene Server bekommt Sprache
 *      und Fassung“
 *   I  die Prüfung connectionAllowed() im Wächter entfernt → rot
 *      „im Release-Build erreicht keine http-Anfrage den Server …“ und „auch der
 *      Debug-Build schickt http nur …“
 *   K  im Wächter `entwicklung` fest auf true → rot „im
 *      Release-Build erreicht keine http-Anfrage den Server …“
 *   H  /settings/theme vom Token ausgenommen (`mitToken` falsch für
 *      Pfade auf "/settings/theme") → rot „the account's design is fetched with the token“
 *   J  im Wächter die Meldung über versionsHint() entfernt → rot „ein
 *      Server mit hoeherer Mindestfassung meldet App zu alt …“ (leere Liste statt APP_ZU_ALT)
 *   L  rightsRevoked() bei jedem 403 → rot „ein 403 nur_admins …“
 *   M  CONFIRMATION_NEEDED nicht beachtet (jeder 401 meldet ab) →
 *      rot „eine falsche Passwortbestaetigung meldet nicht ab“
 *   N  im Wächter die Zeile für PASSWORT_WECHSEL_NOETIG entfernt →
 *      rot „ein 403 passwort_wechsel_noetig verlangt das neue Passwort …“
 *   O  wieder die alte Regel (selbst gesetzter Kopf nur weg, wenn er
 *      der jetzige Token ist) → rot „ein selbst gesetzter Kopf mit einem aelteren
 *      Token …“ und „nach dem Abmelden geht kein selbst gesetzter Kopf hinaus …“
 *   P  nur `!tokenBelongsHere` statt `!mitToken` → rot „nach dem Abmelden …“
 *   R  wieder `herkunft == null ||` in tokenBelongsHere →
 *      rot „a token without binding goes to no server“ (gegenproben/token-ohne-bindung-gesendet.patch)
 *   Q  gegenproben/waechter-ohne-faktorpflicht.patch nimmt
 *      die Zeile für ZWEITER_FAKTOR_PFLICHT heraus → rot „ein 403 zweiter_faktor_pflicht …“
 */
class ServerGuardTest {

    private val server = MockWebServer()
    private val requests = Collections.synchronizedList(mutableListOf<Pair<String, String?>>())
    private val codes = Collections.synchronizedMap(mutableMapOf<String, Int>())
    private val abgelaufen = AtomicInteger()
    private val entzogen = AtomicInteger()
    private val switch = AtomicInteger()
    private val faktor = AtomicInteger()
    /** Rumpf je Pfad für Antworten mit Fehlercode. */
    private val bodies = Collections.synchronizedMap(mutableMapOf<String, String>())

    private inner class Lage(
        var url: String,
        var tokens: ArrayDeque<String> = ArrayDeque(listOf(TOKEN)),
        var herkunft: String? = null,
        /** false: ein Token älterer Fassungen ohne Bindung. */
        val gebunden: Boolean = true,
    ) : Zugangslage {
        override fun serverUrl() = url
        override fun token(): String = if (tokens.size > 1) tokens.removeFirst() else tokens.first()
        override fun tokenOrigin() = if (gebunden) herkunft ?: NetworkPolicy.herkunft(url) else null
        override fun generation() = 0L
    }

    @Before
    fun auf() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val pfad = request.path.orEmpty()
                requests += pfad to request.getHeader("Authorization")
                return MockResponse().setResponseCode(codes[pfad.substringBefore('?')] ?: 200)
                    .setBody(bodies[pfad.substringBefore('?')] ?: """{"success":true}""")
            }
        }
        server.start()
    }

    @After
    fun zu() = server.shutdown()

    private fun basis() = server.url("/").toString().trimEnd('/')

    private fun client(situation: Zugangslage, api: Boolean = true, entwicklung: Boolean = true) = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(situation, api, entwicklung, sitzungAbgelaufen = { abgelaufen.incrementAndGet() },
            ownHeaders = { _, ziel -> ziel.header("Accept-Language", "de") }, rightsRevoked = { entzogen.incrementAndGet() },
            passwordSwitchNeeded = { switch.incrementAndGet() }, zweiterFaktorPflicht = { faktor.incrementAndGet() }))
        .readTimeout(2, TimeUnit.SECONDS).build()

    private fun fetch(c: OkHttpClient, url: String): Int =
        c.newCall(Request.Builder().url(url).build()).execute().use { it.code }

    private fun requestsAn(teil: String) = synchronized(requests) { requests.filter { teil in it.first } }

    @Test
    fun `a token without binding goes to no server`() {
        codes["/api/v1/sets"] = 401
        val c = client(Lage(basis(), gebunden = false))
        assertEquals(401, fetch(c, "http://localhost:3000/api/v1/sets"))
        c.newCall(Request.Builder().url(basis() + "/api/v1/pdf").header("Authorization", "Bearer $TOKEN").build())
            .execute().close()
        assertEquals("Ein ungebundener Token ging hinaus", listOf<String?>(null, null),
            synchronized(requests) { requests.map { it.second } })
        assertEquals("Ohne Token meldet ein 401 nicht ab", 0, abgelaufen.get())
    }

    @Test
    fun `a 401 on the token reports the expired session`() {
        codes["/api/v1/sets"] = 401
        val c = client(Lage(basis()))
        assertEquals(401, fetch(c, "http://localhost:3000/api/v1/sets"))
        assertEquals("Bearer $TOKEN", requestsAn("/api/v1/sets").single().second)
        assertEquals(1, abgelaufen.get())
    }

    @Test
    fun `the image client also attaches the token and reports a 401`() {
        codes["/images/sets/1.jpg"] = 401
        fetch(client(Lage(basis()), api = false), basis() + "/images/sets/1.jpg")
        assertEquals("Bearer $TOKEN", requestsAn("/images/").single().second)
        assertEquals(1, abgelaufen.get())
    }

    /** Ohne Token lieferte der Server die Vorgabe statt des Designs dieses Kontos. */
    @Test
    fun `the account's design is fetched with the token`() {
        fetch(client(Lage(basis())), "http://localhost:3000/api/v1/settings/theme")
        assertEquals("Bearer $TOKEN", requestsAn("/api/v1/settings/theme").single().second)
    }

    @Test
    fun `the placeholder is rewritten to the server including path`() {
        fetch(client(Lage(basis() + "/brick")), "http://localhost:3000/api/v1/sets?seite=2")
        assertEquals("/brick/api/v1/sets?seite=2", requestsAn("/api/v1/sets").single().first)
    }

    @Test
    fun `the token goes only to the server that issued it`() {
        codes["/api/v1/sets"] = 401
        val situation = Lage(basis(), herkunft = "http://anderer.example:3000")
        assertEquals(401, fetch(client(situation), "http://localhost:3000/api/v1/sets"))
        assertNull("Der alte Token ging an den neuen Server", requestsAn("/api/v1/sets").single().second)
        assertEquals("Ohne Token ist ein 401 kein Ablauf", 0, abgelaufen.get())
    }

    @Test
    fun `a self-set header with the token is dropped for a foreign origin`() {
        val situation = Lage(basis(), herkunft = "http://anderer.example:3000")
        client(situation).newCall(Request.Builder().url(basis() + "/api/v1/csv")
            .header("Authorization", "Bearer $TOKEN").build()).execute().close()
        assertNull(requestsAn("/api/v1/csv").single().second)
    }

    /** Ein Tausch, der den Serverwechsel überdauert, trägt den Token des alten Servers. */
    @Test
    fun `a self-set header with an older token is dropped for a foreign origin`() {
        val situation = Lage(basis(), herkunft = "http://anderer.example:3000")
        client(situation).newCall(Request.Builder().url("http://localhost:3000/api/v1/auth/token-rotieren")
            .header("Authorization", "Bearer vom-alten-server").build()).execute().close()
        assertNull(requestsAn("/token-rotieren").single().second)
    }

    @Test
    fun `after sign-out no self-set header goes out, one bound to the own origin does`() {
        client(Lage(basis(), tokens = ArrayDeque(listOf("")))).newCall(Request.Builder().url(basis() + "/api/v1/csv")
            .header("Authorization", "Bearer alt").build()).execute().close()
        assertNull("Abgemeldet: kein Token", requestsAn("/api/v1/csv").single().second)

        val eigene = NetworkPolicy.herkunft(basis())
        client(Lage(basis(), herkunft = eigene)).newCall(Request.Builder().url(basis() + "/api/v1/pdf")
            .header("Authorization", "Bearer alt").build()).execute().close()
        assertEquals("Bearer alt", requestsAn("/api/v1/pdf").single().second)
    }

    @Test
    fun `the own server gets language and version`() {
        fetch(client(Lage(basis(), tokens = ArrayDeque(listOf(""))), api = false), basis() + "/api/v1/stats")
        val r = server.takeRequest()
        assertEquals("de", r.getHeader("Accept-Language"))
        assertEquals(APP_API_VERSION.toString(), r.getHeader("X-App-Api"))
    }

    @Test
    fun `a server with a higher minimum version reports app too old instead of a read error`() {
        // So antwortet der Server einer alten App: 426 samt beiden Fassungen im Kopf.
        val neuer = (APP_API_VERSION + 1).toString()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setResponseCode(426)
                .setHeader("X-Api-Version", neuer).setHeader("X-Api-Min-App", neuer)
                .setBody("""{"success":false,"error":"App zu alt","code":"app_zu_alt"}""")
        }
        val hinweise = Collections.synchronizedList(mutableListOf<VersionsHint>())
        val c = OkHttpClient.Builder()
            .addInterceptor(ServerWaechter(Lage(basis(), tokens = ArrayDeque(listOf(""))), true, true,
                sitzungAbgelaufen = { abgelaufen.incrementAndGet() }, versionsMessage = { hinweise += it }))
            .readTimeout(2, TimeUnit.SECONDS).build()
        assertEquals(426, fetch(c, basis() + "/api/v1/auth/profile"))
        assertEquals(426, fetch(c, basis() + "/api/v1/sets"))
        assertEquals("einmal gemeldet, nicht je Anfrage", listOf(VersionsHint.APP_ZU_ALT), hinweise.toList())
        assertEquals(0, abgelaufen.get())
    }

    @Test
    fun `a foreign host gets neither token nor language`() {
        // Derselbe Testserver unter seiner IP ist für den Wächter ein anderer Host.
        val fremd = server.url("/bild.jpg").newBuilder().host("127.0.0.1").build().toString()
        fetch(client(Lage(server.url("/").newBuilder().host("localhost").build().toString()), api = false), fremd)
        val r = server.takeRequest()
        assertNull(r.getHeader("Authorization"))
        assertNull(r.getHeader("Accept-Language"))
        assertNull(r.getHeader("X-App-Api"))
    }

    @Test
    fun `a request without a token reaches for the new one`() {
        // Die erste Lesung liefert noch keinen Token, die zweite den frisch abgelegten.
        codes["/api/v1/sets"] = 401
        val situation = Lage(basis(), tokens = ArrayDeque(listOf("", TOKEN)))
        fetch(client(situation), "http://localhost:3000/api/v1/sets")
        val an = requestsAn("/api/v1/sets")
        assertEquals(listOf(null, "Bearer $TOKEN"), an.map { it.second })
        assertEquals("Nach dem Nachfassen ist der 401 echt", 1, abgelaufen.get())
    }

    @Test
    fun `a 401 without a token does not sign out`() {
        codes["/api/v1/auth/login"] = 401
        val situation = Lage(basis(), tokens = ArrayDeque(listOf("")))
        assertEquals(401, fetch(client(situation), "http://localhost:3000/api/v1/auth/login"))
        assertEquals(0, abgelaufen.get())
    }

    /** Die Regel des Release-Builds: kein http, auch nicht zum Gerät selbst. */
    @Test
    fun `in the release build no http request reaches the server, not even localhost`() {
        val c = client(Lage(basis()), entwicklung = false)
        for (url in listOf("http://localhost:3000/api/v1/sets", basis() + "/images/sets/1.jpg")) {
            try {
                fetch(c, url)
                fail("$url darf nicht hinausgehen")
            } catch (e: PlaintextRejected) {
                assertEquals(server.url("/").host, e.host)
            }
        }
        assertEquals("Weder Token noch Anfrage gingen hinaus", 0, server.requestCount)
        assertEquals(0, abgelaufen.get())
    }

    /** Der Debug-Build darf http nur zu den drei Hosts seiner Network-Security-Config. */
    @Test
    fun `the debug build also sends http only to the device and the emulator host`() {
        for (adresse in listOf("http://nas:3000", "http://192.168.1.50:3000", "http://brick.example.org")) {
            try {
                fetch(client(Lage(adresse)), "http://localhost:3000/api/v1/sets")
                fail("$adresse darf nicht im Klartext erreicht werden")
            } catch (_: PlaintextRejected) { }
        }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `a 403 nur_admins on a token reports the revocation of rights, another 403 does not`() {
        codes["/api/v1/admin/jobs"] = 403
        bodies["/api/v1/admin/jobs"] = """{"success":false,"code":"nur_admins","error":"Nur für Admins"}"""
        codes["/api/v1/auth/passkey/registrieren/optionen"] = 403
        bodies["/api/v1/auth/passkey/registrieren/optionen"] = """{"success":false,"code":"nur_mit_sitzung"}"""
        val c = client(Lage(basis()))
        assertEquals(403, fetch(c, "http://localhost:3000/api/v1/admin/jobs"))
        assertEquals(403, fetch(c, "http://localhost:3000/api/v1/auth/passkey/registrieren/optionen"))
        assertEquals(1, entzogen.get())
        assertEquals("Ein 403 ist keine abgelaufene Sitzung", 0, abgelaufen.get())

        fetch(client(Lage(basis(), tokens = ArrayDeque(listOf("")))), "http://localhost:3000/api/v1/admin/jobs")
        assertEquals("Ohne Token sagt ein 403 nichts über dieses Konto", 1, entzogen.get())
    }

    @Test
    fun `a 403 passwort_wechsel_noetig requires the new password without signing out`() {
        codes["/api/v1/sets"] = 403
        bodies["/api/v1/sets"] = """{"success":false,"code":"passwort_wechsel_noetig","error":"Bitte zuerst das Startpasswort ändern."}"""
        codes["/api/v1/admin/jobs"] = 403
        bodies["/api/v1/admin/jobs"] = """{"success":false,"code":"nur_admins"}"""
        val c = client(Lage(basis()))
        assertEquals(403, fetch(c, "http://localhost:3000/api/v1/sets"))
        assertEquals(1, switch.get())
        fetch(c, "http://localhost:3000/api/v1/admin/jobs")
        assertEquals("Ein anderes 403 verlangt keinen Wechsel", 1, switch.get())
        assertEquals("Kein Abmelden", 0, abgelaufen.get())
    }

    @Test
    fun `a 403 zweiter_faktor_pflicht requires the setup without signing out`() {
        codes["/api/v1/sets"] = 403
        bodies["/api/v1/sets"] = """{"success":false,"code":"zweiter_faktor_pflicht","error":"Bitte zuerst einen Code-Generator einrichten."}"""
        codes["/api/v1/admin/jobs"] = 403
        bodies["/api/v1/admin/jobs"] = """{"success":false,"code":"passwort_wechsel_noetig"}"""
        val c = client(Lage(basis()))
        assertEquals(403, fetch(c, "http://localhost:3000/api/v1/sets"))
        assertEquals(1, faktor.get())
        fetch(c, "http://localhost:3000/api/v1/admin/jobs")
        assertEquals("Ein anderes 403 verlangt keinen zweiten Faktor", 1, faktor.get())
        assertEquals("Kein Abmelden", 0, abgelaufen.get())
        assertEquals("Kein entzogenes Recht", 0, entzogen.get())

        fetch(client(Lage(basis(), tokens = ArrayDeque(listOf("")))), "http://localhost:3000/api/v1/sets")
        assertEquals("Ohne Token sagt ein 403 nichts über dieses Konto", 1, faktor.get())
    }

    @Test
    fun `a wrong password confirmation does not sign out, an invalid token does`() {
        codes["/api/v1/auth/zweiter-faktor/abschalten"] = 401
        bodies["/api/v1/auth/zweiter-faktor/abschalten"] = """{"success":false,"code":"aktuelles_passwort_falsch"}"""
        codes["/api/v1/sets"] = 401
        bodies["/api/v1/sets"] = """{"success":false,"code":"token_ungueltig"}"""
        val c = client(Lage(basis()))
        assertEquals(401, fetch(c, "http://localhost:3000/api/v1/auth/zweiter-faktor/abschalten"))
        assertEquals("Die Bestätigung fragt erneut, statt abzumelden", 0, abgelaufen.get())
        assertEquals(401, fetch(c, "http://localhost:3000/api/v1/sets"))
        assertEquals(1, abgelaufen.get())
    }

    private companion object { const val TOKEN = "geheim-0123" }
}
