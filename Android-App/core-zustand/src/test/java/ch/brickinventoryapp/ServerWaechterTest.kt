package ch.brickinventoryapp

import ch.brickinventoryapp.di.ServerWaechter
import ch.brickinventoryapp.di.Zugangslage
import ch.brickinventoryapp.util.KlartextAbgelehnt
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
import ch.brickinventoryapp.util.APP_API_VERSION
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.VersionsHinweis

/**
 * Der Wächter aller Anfragen an den eigenen Server, ausgeführt gegen einen
 * Testserver über http auf localhost. Das darf nur der Debug-Build; die Tests der
 * Regeln für Token und Köpfe laufen darum mit `entwicklung = true`, die Tests des
 * Klartext-Verbots mit beiden Werten.
 *
 * Gegenproben (am 29.10.2026 gemessen, kotlinc gegen di/ServerWaechter.kt):
 *   B  `tokenGehoertHierher` immer true → rot „der Token geht nur an den Server,
 *      der ihn ausgab“ und „ein selbst gesetzter Kopf …“
 *   C  `unserServer` ohne isSameOrigin (nur serverUrl.isNotBlank()) → rot
 *      „ein fremder Host bekommt weder Token noch Sprache“
 *   D  das Nachfassen entfernt → rot „eine Anfrage ohne Token fasst mit dem neuen nach“
 *   E  die 401-Meldung ohne `tokenMitgeschickt` → rot „ein 401 ohne Token meldet
 *      nicht ab“ und „der Token geht nur an den Server, der ihn ausgab“
 *   F  den Pfad des Servers beim Umschreiben weggelassen → rot „der Platzhalter
 *      wird auf den Server samt Pfad umgeschrieben“
 *   G  eigeneKoepfe() nicht aufgerufen → rot „der eigene Server bekommt Sprache
 *      und Fassung“
 *   I  die Prüfung verbindungErlaubt() im Wächter entfernt → rot
 *      „im Release-Build erreicht keine http-Anfrage den Server …“ und „auch der
 *      Debug-Build schickt http nur …“
 *   K  im Wächter `entwicklung` fest auf true → rot „im
 *      Release-Build erreicht keine http-Anfrage den Server …“
 *   H  /settings/theme vom Token ausgenommen (`mitToken` falsch für
 *      Pfade auf "/settings/theme") → rot „das Design des Kontos wird mit Token geholt“
 *   J  im Wächter die Meldung über versionsHinweis() entfernt → rot „ein
 *      Server mit hoeherer Mindestfassung meldet App zu alt …“ (leere Liste statt APP_ZU_ALT)
 *   L  rechteEntzogen() bei jedem 403 → rot „ein 403 nur_admins …“
 *   M  BESTAETIGUNG_NOETIG nicht beachtet (jeder 401 meldet ab) →
 *      rot „eine falsche Passwortbestaetigung meldet nicht ab“
 *   N  im Wächter die Zeile für PASSWORT_WECHSEL_NOETIG entfernt →
 *      rot „ein 403 passwort_wechsel_noetig verlangt das neue Passwort …“
 *   O  wieder die alte Regel (selbst gesetzter Kopf nur weg, wenn er
 *      der jetzige Token ist) → rot „ein selbst gesetzter Kopf mit einem aelteren
 *      Token …“ und „nach dem Abmelden geht kein selbst gesetzter Kopf hinaus …“
 *   P  nur `!tokenGehoertHierher` statt `!mitToken` → rot „nach dem Abmelden …“
 *   R  wieder `herkunft == null ||` in tokenGehoertHierher →
 *      rot „ein Token ohne Bindung geht an keinen Server“ (gegenproben/token-ohne-bindung-gesendet.patch)
 *   Q  gegenproben/waechter-ohne-faktorpflicht.patch nimmt
 *      die Zeile für ZWEITER_FAKTOR_PFLICHT heraus → rot „ein 403 zweiter_faktor_pflicht …“
 */
class ServerWaechterTest {

    private val server = MockWebServer()
    private val anfragen = Collections.synchronizedList(mutableListOf<Pair<String, String?>>())
    private val codes = Collections.synchronizedMap(mutableMapOf<String, Int>())
    private val abgelaufen = AtomicInteger()
    private val entzogen = AtomicInteger()
    private val wechsel = AtomicInteger()
    private val faktor = AtomicInteger()
    /** Rumpf je Pfad für Antworten mit Fehlercode. */
    private val ruempfe = Collections.synchronizedMap(mutableMapOf<String, String>())

    private inner class Lage(
        var url: String,
        var tokens: ArrayDeque<String> = ArrayDeque(listOf(TOKEN)),
        var herkunft: String? = null,
        /** false: ein Token älterer Fassungen ohne Bindung. */
        val gebunden: Boolean = true,
    ) : Zugangslage {
        override fun serverUrl() = url
        override fun token(): String = if (tokens.size > 1) tokens.removeFirst() else tokens.first()
        override fun tokenHerkunft() = if (gebunden) herkunft ?: NetworkPolicy.herkunft(url) else null
        override fun generation() = 0L
    }

    @Before
    fun auf() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val pfad = request.path.orEmpty()
                anfragen += pfad to request.getHeader("Authorization")
                return MockResponse().setResponseCode(codes[pfad.substringBefore('?')] ?: 200)
                    .setBody(ruempfe[pfad.substringBefore('?')] ?: """{"success":true}""")
            }
        }
        server.start()
    }

    @After
    fun zu() = server.shutdown()

    private fun basis() = server.url("/").toString().trimEnd('/')

    private fun client(lage: Zugangslage, api: Boolean = true, entwicklung: Boolean = true) = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(lage, api, entwicklung, sitzungAbgelaufen = { abgelaufen.incrementAndGet() },
            eigeneKoepfe = { _, ziel -> ziel.header("Accept-Language", "de") }, rechteEntzogen = { entzogen.incrementAndGet() },
            passwortWechselNoetig = { wechsel.incrementAndGet() }, zweiterFaktorPflicht = { faktor.incrementAndGet() }))
        .readTimeout(2, TimeUnit.SECONDS).build()

    private fun hole(c: OkHttpClient, url: String): Int =
        c.newCall(Request.Builder().url(url).build()).execute().use { it.code }

    private fun anfragenAn(teil: String) = synchronized(anfragen) { anfragen.filter { teil in it.first } }

    @Test
    fun `ein Token ohne Bindung geht an keinen Server`() {
        codes["/api/v1/sets"] = 401
        val c = client(Lage(basis(), gebunden = false))
        assertEquals(401, hole(c, "http://localhost:3000/api/v1/sets"))
        c.newCall(Request.Builder().url(basis() + "/api/v1/pdf").header("Authorization", "Bearer $TOKEN").build())
            .execute().close()
        assertEquals("Ein ungebundener Token ging hinaus", listOf<String?>(null, null),
            synchronized(anfragen) { anfragen.map { it.second } })
        assertEquals("Ohne Token meldet ein 401 nicht ab", 0, abgelaufen.get())
    }

    @Test
    fun `ein 401 auf den Token meldet die abgelaufene Sitzung`() {
        codes["/api/v1/sets"] = 401
        val c = client(Lage(basis()))
        assertEquals(401, hole(c, "http://localhost:3000/api/v1/sets"))
        assertEquals("Bearer $TOKEN", anfragenAn("/api/v1/sets").single().second)
        assertEquals(1, abgelaufen.get())
    }

    @Test
    fun `auch der Bild-Client haengt den Token an und meldet einen 401`() {
        codes["/images/sets/1.jpg"] = 401
        hole(client(Lage(basis()), api = false), basis() + "/images/sets/1.jpg")
        assertEquals("Bearer $TOKEN", anfragenAn("/images/").single().second)
        assertEquals(1, abgelaufen.get())
    }

    /** Ohne Token lieferte der Server die Vorgabe statt des Designs dieses Kontos. */
    @Test
    fun `das Design des Kontos wird mit Token geholt`() {
        hole(client(Lage(basis())), "http://localhost:3000/api/v1/settings/theme")
        assertEquals("Bearer $TOKEN", anfragenAn("/api/v1/settings/theme").single().second)
    }

    @Test
    fun `der Platzhalter wird auf den Server samt Pfad umgeschrieben`() {
        hole(client(Lage(basis() + "/brick")), "http://localhost:3000/api/v1/sets?seite=2")
        assertEquals("/brick/api/v1/sets?seite=2", anfragenAn("/api/v1/sets").single().first)
    }

    @Test
    fun `der Token geht nur an den Server, der ihn ausgab`() {
        codes["/api/v1/sets"] = 401
        val lage = Lage(basis(), herkunft = "http://anderer.example:3000")
        assertEquals(401, hole(client(lage), "http://localhost:3000/api/v1/sets"))
        assertNull("Der alte Token ging an den neuen Server", anfragenAn("/api/v1/sets").single().second)
        assertEquals("Ohne Token ist ein 401 kein Ablauf", 0, abgelaufen.get())
    }

    @Test
    fun `ein selbst gesetzter Kopf mit dem Token faellt bei fremder Herkunft weg`() {
        val lage = Lage(basis(), herkunft = "http://anderer.example:3000")
        client(lage).newCall(Request.Builder().url(basis() + "/api/v1/csv")
            .header("Authorization", "Bearer $TOKEN").build()).execute().close()
        assertNull(anfragenAn("/api/v1/csv").single().second)
    }

    /** Ein Tausch, der den Serverwechsel überdauert, trägt den Token des alten Servers. */
    @Test
    fun `ein selbst gesetzter Kopf mit einem aelteren Token faellt bei fremder Herkunft weg`() {
        val lage = Lage(basis(), herkunft = "http://anderer.example:3000")
        client(lage).newCall(Request.Builder().url("http://localhost:3000/api/v1/auth/token-rotieren")
            .header("Authorization", "Bearer vom-alten-server").build()).execute().close()
        assertNull(anfragenAn("/token-rotieren").single().second)
    }

    @Test
    fun `nach dem Abmelden geht kein selbst gesetzter Kopf hinaus, an die eigene Herkunft gebunden schon`() {
        client(Lage(basis(), tokens = ArrayDeque(listOf("")))).newCall(Request.Builder().url(basis() + "/api/v1/csv")
            .header("Authorization", "Bearer alt").build()).execute().close()
        assertNull("Abgemeldet: kein Token", anfragenAn("/api/v1/csv").single().second)

        val eigene = NetworkPolicy.herkunft(basis())
        client(Lage(basis(), herkunft = eigene)).newCall(Request.Builder().url(basis() + "/api/v1/pdf")
            .header("Authorization", "Bearer alt").build()).execute().close()
        assertEquals("Bearer alt", anfragenAn("/api/v1/pdf").single().second)
    }

    @Test
    fun `der eigene Server bekommt Sprache und Fassung`() {
        hole(client(Lage(basis(), tokens = ArrayDeque(listOf(""))), api = false), basis() + "/api/v1/stats")
        val r = server.takeRequest()
        assertEquals("de", r.getHeader("Accept-Language"))
        assertEquals(APP_API_VERSION.toString(), r.getHeader("X-App-Api"))
    }

    @Test
    fun `ein Server mit hoeherer Mindestfassung meldet App zu alt statt eines Lesefehlers`() {
        // So antwortet der Server einer alten App: 426 samt beiden Fassungen im Kopf.
        val neuer = (APP_API_VERSION + 1).toString()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setResponseCode(426)
                .setHeader("X-Api-Version", neuer).setHeader("X-Api-Min-App", neuer)
                .setBody("""{"success":false,"error":"App zu alt","code":"app_zu_alt"}""")
        }
        val hinweise = Collections.synchronizedList(mutableListOf<VersionsHinweis>())
        val c = OkHttpClient.Builder()
            .addInterceptor(ServerWaechter(Lage(basis(), tokens = ArrayDeque(listOf(""))), true, true,
                sitzungAbgelaufen = { abgelaufen.incrementAndGet() }, versionsMeldung = { hinweise += it }))
            .readTimeout(2, TimeUnit.SECONDS).build()
        assertEquals(426, hole(c, basis() + "/api/v1/auth/profile"))
        assertEquals(426, hole(c, basis() + "/api/v1/sets"))
        assertEquals("einmal gemeldet, nicht je Anfrage", listOf(VersionsHinweis.APP_ZU_ALT), hinweise.toList())
        assertEquals(0, abgelaufen.get())
    }

    @Test
    fun `ein fremder Host bekommt weder Token noch Sprache`() {
        // Derselbe Testserver unter seiner IP ist für den Wächter ein anderer Host.
        val fremd = server.url("/bild.jpg").newBuilder().host("127.0.0.1").build().toString()
        hole(client(Lage(server.url("/").newBuilder().host("localhost").build().toString()), api = false), fremd)
        val r = server.takeRequest()
        assertNull(r.getHeader("Authorization"))
        assertNull(r.getHeader("Accept-Language"))
        assertNull(r.getHeader("X-App-Api"))
    }

    @Test
    fun `eine Anfrage ohne Token fasst mit dem neuen nach`() {
        // Die erste Lesung liefert noch keinen Token, die zweite den frisch abgelegten.
        codes["/api/v1/sets"] = 401
        val lage = Lage(basis(), tokens = ArrayDeque(listOf("", TOKEN)))
        hole(client(lage), "http://localhost:3000/api/v1/sets")
        val an = anfragenAn("/api/v1/sets")
        assertEquals(listOf(null, "Bearer $TOKEN"), an.map { it.second })
        assertEquals("Nach dem Nachfassen ist der 401 echt", 1, abgelaufen.get())
    }

    @Test
    fun `ein 401 ohne Token meldet nicht ab`() {
        codes["/api/v1/auth/login"] = 401
        val lage = Lage(basis(), tokens = ArrayDeque(listOf("")))
        assertEquals(401, hole(client(lage), "http://localhost:3000/api/v1/auth/login"))
        assertEquals(0, abgelaufen.get())
    }

    /** Die Regel des Release-Builds: kein http, auch nicht zum Gerät selbst. */
    @Test
    fun `im Release-Build erreicht keine http-Anfrage den Server, auch nicht localhost`() {
        val c = client(Lage(basis()), entwicklung = false)
        for (url in listOf("http://localhost:3000/api/v1/sets", basis() + "/images/sets/1.jpg")) {
            try {
                hole(c, url)
                fail("$url darf nicht hinausgehen")
            } catch (e: KlartextAbgelehnt) {
                assertEquals(server.url("/").host, e.host)
            }
        }
        assertEquals("Weder Token noch Anfrage gingen hinaus", 0, server.requestCount)
        assertEquals(0, abgelaufen.get())
    }

    /** Der Debug-Build darf http nur zu den drei Hosts seiner Network-Security-Config. */
    @Test
    fun `auch der Debug-Build schickt http nur zum Geraet und zum Emulator-Host`() {
        for (adresse in listOf("http://nas:3000", "http://192.168.1.50:3000", "http://brick.example.org")) {
            try {
                hole(client(Lage(adresse)), "http://localhost:3000/api/v1/sets")
                fail("$adresse darf nicht im Klartext erreicht werden")
            } catch (_: KlartextAbgelehnt) { }
        }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `ein 403 nur_admins auf einen Token meldet den Rechteentzug, ein anderes 403 nicht`() {
        codes["/api/v1/admin/jobs"] = 403
        ruempfe["/api/v1/admin/jobs"] = """{"success":false,"code":"nur_admins","error":"Nur für Admins"}"""
        codes["/api/v1/auth/passkey/registrieren/optionen"] = 403
        ruempfe["/api/v1/auth/passkey/registrieren/optionen"] = """{"success":false,"code":"nur_mit_sitzung"}"""
        val c = client(Lage(basis()))
        assertEquals(403, hole(c, "http://localhost:3000/api/v1/admin/jobs"))
        assertEquals(403, hole(c, "http://localhost:3000/api/v1/auth/passkey/registrieren/optionen"))
        assertEquals(1, entzogen.get())
        assertEquals("Ein 403 ist keine abgelaufene Sitzung", 0, abgelaufen.get())

        hole(client(Lage(basis(), tokens = ArrayDeque(listOf("")))), "http://localhost:3000/api/v1/admin/jobs")
        assertEquals("Ohne Token sagt ein 403 nichts über dieses Konto", 1, entzogen.get())
    }

    @Test
    fun `ein 403 passwort_wechsel_noetig verlangt das neue Passwort, ohne abzumelden`() {
        codes["/api/v1/sets"] = 403
        ruempfe["/api/v1/sets"] = """{"success":false,"code":"passwort_wechsel_noetig","error":"Bitte zuerst das Startpasswort ändern."}"""
        codes["/api/v1/admin/jobs"] = 403
        ruempfe["/api/v1/admin/jobs"] = """{"success":false,"code":"nur_admins"}"""
        val c = client(Lage(basis()))
        assertEquals(403, hole(c, "http://localhost:3000/api/v1/sets"))
        assertEquals(1, wechsel.get())
        hole(c, "http://localhost:3000/api/v1/admin/jobs")
        assertEquals("Ein anderes 403 verlangt keinen Wechsel", 1, wechsel.get())
        assertEquals("Kein Abmelden", 0, abgelaufen.get())
    }

    @Test
    fun `ein 403 zweiter_faktor_pflicht verlangt die Einrichtung, ohne abzumelden`() {
        codes["/api/v1/sets"] = 403
        ruempfe["/api/v1/sets"] = """{"success":false,"code":"zweiter_faktor_pflicht","error":"Bitte zuerst einen Code-Generator einrichten."}"""
        codes["/api/v1/admin/jobs"] = 403
        ruempfe["/api/v1/admin/jobs"] = """{"success":false,"code":"passwort_wechsel_noetig"}"""
        val c = client(Lage(basis()))
        assertEquals(403, hole(c, "http://localhost:3000/api/v1/sets"))
        assertEquals(1, faktor.get())
        hole(c, "http://localhost:3000/api/v1/admin/jobs")
        assertEquals("Ein anderes 403 verlangt keinen zweiten Faktor", 1, faktor.get())
        assertEquals("Kein Abmelden", 0, abgelaufen.get())
        assertEquals("Kein entzogenes Recht", 0, entzogen.get())

        hole(client(Lage(basis(), tokens = ArrayDeque(listOf("")))), "http://localhost:3000/api/v1/sets")
        assertEquals("Ohne Token sagt ein 403 nichts über dieses Konto", 1, faktor.get())
    }

    @Test
    fun `eine falsche Passwortbestaetigung meldet nicht ab, ein ungueltiger Token schon`() {
        codes["/api/v1/auth/zweiter-faktor/abschalten"] = 401
        ruempfe["/api/v1/auth/zweiter-faktor/abschalten"] = """{"success":false,"code":"aktuelles_passwort_falsch"}"""
        codes["/api/v1/sets"] = 401
        ruempfe["/api/v1/sets"] = """{"success":false,"code":"token_ungueltig"}"""
        val c = client(Lage(basis()))
        assertEquals(401, hole(c, "http://localhost:3000/api/v1/auth/zweiter-faktor/abschalten"))
        assertEquals("Die Bestätigung fragt erneut, statt abzumelden", 0, abgelaufen.get())
        assertEquals(401, hole(c, "http://localhost:3000/api/v1/sets"))
        assertEquals(1, abgelaufen.get())
    }

    private companion object { const val TOKEN = "geheim-0123" }
}
