package ch.brickinventoryapp

import ch.brickinventoryapp.ui.parseQrPayload
import ch.brickinventoryapp.util.PinAblage
import ch.brickinventoryapp.util.PinVertrauen
import ch.brickinventoryapp.util.WahlVertrauen
import ch.brickinventoryapp.util.ZertifikatUngeklaert
import ch.brickinventoryapp.util.ZertifikatsFrage
import ch.brickinventoryapp.util.bestaetigtFingerabdruck
import ch.brickinventoryapp.util.fingerabdruckAnfang
import ch.brickinventoryapp.util.fingerabdruckLesbar
import ch.brickinventoryapp.util.passtZumPin
import ch.brickinventoryapp.util.pinSchluessel
import ch.brickinventoryapp.util.spkiFingerabdruck
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.security.KeyFactory
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager

/**
 * Pinning des eigenen Servers, über echtes TLS gegen einen Testserver: Wurzel →
 * Zwischenstelle → Blatt „localhost“, dazu ein fremdes selbst signiertes Blatt.
 * Die Zertifikate sind feste Testdaten (100 Jahre gültig).
 *
 * Gegenproben (30.10.2026, gemessen gegen util/ServerVertrauen.kt):
 *   A  in pruefe() ohne Pin `return kettenPruefung()` statt nachzufragen → rot
 *      „ohne Pin geht beim ersten Kontakt nichts hinaus“
 *   B  passtZumPin() nur `indexOfFirst >= 0` (ohne Pfadprüfung) → rot „ein
 *      fremdes Blatt mit angehängter echter Zwischenstelle passt nicht“
 *   C  bei abweichendem Pin `return` statt zu melden → rot „ein anderer
 *      Schlüssel unter dem gemerkten Pin wird nicht still angenommen“
 *   D  der Vergleich mit eigenerServer() entfernt (alle Hosts gepinnt) → rot
 *      „fremde Hosts prüft nur die Kette“
 *   E  parseQrPayload() übernimmt ein unlesbares fp → rot „ein QR-Code mit
 *      unlesbarem Fingerabdruck gilt nicht“
 *   F  (01.11.2026) in pruefe() wieder `chain[0]` statt `chain.last()` → rot
 *      „ohne Pin geht beim ersten Kontakt nichts hinaus …“ (Blatt statt
 *      Zwischenstelle) und „ein erneuertes Blatt unter der bestätigten Wurzel …“
 *      (nach der Erneuerung GEAENDERT)
 *   G  (01.11.2026) fingerabdruckLesbar() wieder in Vierergruppen → rot „der
 *      Fingerabdruck steht da wie in der Webapp“
 *   H  (01.11.2026) in pruefe() fremde Hosts wieder mit `kette` statt
 *      `fremdeHosts` → rot „Nutzer-CAs gelten nur fuer den eigenen Server …“
 *   I  in pruefe() wieder `spkiFingerabdruck(chain.last())` statt der Wurzel
 *      aus dem System → rot „eine oeffentliche CA bietet ihre Wurzel an …“
 *      und „ohne Pin geht beim ersten Kontakt nichts hinaus …“
 *   J  in ZertifikatsFrage.bestaetige() die Bedingung für GEAENDERT entfernt →
 *      rot „ein geaenderter Schluessel gilt erst mit abgeschriebenem …“
 *   K  bestaetigtFingerabdruck() mit `>= 4` statt `>= 16` → rot „ein
 *      geaenderter Schluessel …“ (vier getippte Zeichen genügten); am 02.11.2026
 *      FINGERABDRUCK_ABTIPPEN = 16 statt 24 → rot dort („16 Zeichen (64 Bit) …“)
 *   L  in bestaetige() wieder nur GEAENDERT prüfen (`f.art == GEAENDERT &&`)
 *      → rot „ohne bekannte CA genuegt ein Tipp nicht …“
 *   M  (02.11.2026) die Zeile `if (pin != null && oeffentlich && pin in
 *      systemWurzeln) return` entfernt → rot „ein oeffentlicher Pin uebersteht
 *      …“ („Neue Wurzel, öffentlich gültig“), „eine oeffentliche CA …“, „ein
 *      geaenderter Schluessel …“
 *   N  dort ohne `&& pin in systemWurzeln` → rot „ein oeffentlicher Pin …“
 *      („Eine eigene CA bleibt an ihren Schlüssel gebunden“) und „ein anderer
 *      Schluessel unter dem gemerkten Pin …“
 *   O  `ueberNutzerCa -> NUTZER_CA` wieder ERSTKONTAKT → rot „ueber eine
 *      Nutzer-CA genuegt …“ („Ein Tipp genügt nicht“) und „Nutzer-CAs gelten …“
 *   P  in checkServerTrusted ohne Socket `if (!passtZumPin(chain, pin))` →
 *      `if (pin.isEmpty())` → rot „ohne Host faellt ein gepinnter Server …“
 *   Q  fingerabdruckAnfang() ohne `.take(11)` → rot „der gezeigte Anfang …“
 * Gegenproben (03.11.2026, gemessen mit kotlinc lokal; pruef6 H1, H3):
 *   R  in pruefe() ohne Handshake-Sitzung wieder `mit(fremdeHosts)` → rot „ohne
 *      Handshake-Sitzung gilt der Pin des eigenen Servers“
 *   S  ErneuerbareTlsFabrik.erneuere() ohne Wirkung → rot „nach dem Erneuern prueft
 *      eine neue Verbindung die Kette wieder“ (die Sitzung wurde wiederaufgenommen)
 * Gegenprobe (04.11.2026, gemessen mit kotlinc lokal; sec11 H6):
 *   T  in pruefe() wieder `if (pin != null && passtZumPin(chain, pin)) return` (auch
 *      für eine System-Wurzel) → rot „ein Pin auf eine System-Wurzel gilt nur mit der
 *      System-Pruefung …“; gegenproben/wurzelpin-ohne-ct.patch
 */
class ZertifikatPinTest {

    private var server = MockWebServer()
    private val frage = ZertifikatsFrage()
    private val pins = object : PinAblage {
        val map = mutableMapOf<String, String>()
        override fun pin(schluessel: String) = map[schluessel]
        override fun merkePin(schluessel: String, fingerabdruck: String) { map[schluessel] = fingerabdruck }
    }

    @After
    fun zu() = server.shutdown()

    /** Der Server zeigt Blatt und Zwischenstelle, wie Caddy es tut. */
    private fun starte(schluessel: String = LEAF_KEY, kette: List<String> = listOf(LEAF, INTER)) {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        val key = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(schluessel)))
        ks.setKeyEntry("k", key, PW, kette.map { zert(it) }.toTypedArray())
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, PW) }
        server.useHttps(SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }.socketFactory, false)
        server.enqueue(MockResponse().setBody("ok"))
        server.enqueue(MockResponse().setBody("ok"))
        server.start()
    }

    /** Das „System“: vertraut nur den genannten Wurzeln. */
    private fun system(vararg wurzeln: String): X509ExtendedTrustManager {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        wurzeln.forEachIndexed { i, w -> ks.setCertificateEntry("w$i", zert(w)) }
        return TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(ks) }.trustManagers.filterIsInstance<X509ExtendedTrustManager>().first()
    }

    private fun eigener() = "${server.url("/").host}:${server.port}"

    private fun hole(kette: X509ExtendedTrustManager, eigen: String = eigener(), fremd: X509ExtendedTrustManager = kette): Boolean {
        val tm = PinVertrauen(kette, pins, eigenerServer = { eigen }, frage = frage, fremdeHosts = fremd)
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
        val c = OkHttpClient.Builder().sslSocketFactory(ctx.socketFactory, tm)
            .connectTimeout(2, TimeUnit.SECONDS).readTimeout(2, TimeUnit.SECONDS).build()
        return try {
            c.newCall(Request.Builder().url(server.url("/api/v1/sets")).build()).execute().use { it.isSuccessful }
        } catch (_: IOException) { false }
    }

    @Test
    fun `ohne Pin geht beim ersten Kontakt nichts hinaus, gefragt wird nach dem Fingerabdruck`() {
        starte()
        assertFalse(hole(system(ROOT)))
        assertEquals("Keine Anfrage darf den Server erreichen", 0, server.requestCount)
        val f = frage.offen.value!!
        assertEquals(ZertifikatUngeklaert.Art.ERSTKONTAKT, f.art)
        assertEquals("Angeboten wird die Wurzel, der das System vertraut", spkiFingerabdruck(zert(ROOT)), f.fingerabdruck)
        assertEquals(eigener(), f.schluessel)

        frage.bestaetige(pins)
        assertNull(frage.offen.value)
        assertTrue("Nach der Bestätigung gilt der Pin", hole(system(ROOT)))
    }

    /** Die letzten 24 Hex-Zeichen, wie sie jemand aus der Webapp abschreibt. */
    private fun abgeschrieben() = fingerabdruckLesbar(frage.offen.value!!.fingerabdruck).takeLast(35)

    @Test
    fun `nach der Bestaetigung gilt der Pin auch ohne bekannte CA`() {
        starte()
        assertFalse(hole(system(FREMD)))
        assertEquals(ZertifikatUngeklaert.Art.UNBEKANNTE_CA, frage.offen.value?.art)
        assertTrue(frage.bestaetige(pins, abgeschrieben()))
        assertTrue(hole(system(FREMD)))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `ein anderer Schluessel unter dem gemerkten Pin wird nicht still angenommen`() {
        starte()
        pins.merkePin(eigener(), spkiFingerabdruck(zert(FREMD)))
        assertFalse(hole(system(ROOT)))
        val f = frage.offen.value!!
        assertEquals(ZertifikatUngeklaert.Art.GEAENDERT, f.art)
        assertEquals(spkiFingerabdruck(zert(FREMD)), f.erwartet)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `der Pin einer Zwischenstelle aus dem QR-Code deckt das Blatt ohne bekannte CA`() {
        starte()
        pins.merkePin(eigener(), spkiFingerabdruck(zert(INTER)))
        assertTrue(hole(system(FREMD)))
        assertNull(frage.offen.value)
    }

    /**
     * Caddy mit `sign_with_root`: Die Kette ist Blatt + Wurzel, und der QR-Code
     * trägt den Fingerabdruck der WURZEL. Sie genügt als Pin.
     * Gegenprobe (30.10.2026, gemessen): in passtZumPin nur das Blatt prüfen
     * (`indexOfFirst { … }` → `if (spkiFingerabdruck(chain[0]) == pin) 0 else -1`) → rot.
     */
    @Test
    fun `die Wurzel aus dem QR-Code genuegt als Pin, wenn die Kette Blatt und Wurzel ist`() {
        starte(WURZEL_BLATT_KEY, listOf(WURZEL_BLATT, WURZEL))
        pins.merkePin(eigener(), spkiFingerabdruck(zert(WURZEL)))
        assertTrue(hole(system(FREMD)))
        assertNull(frage.offen.value)
        assertFalse(passtZumPin(arrayOf(zert(FREMD), zert(WURZEL)), spkiFingerabdruck(zert(WURZEL))))
    }

    /**
     * Caddy erneuert sein Blatt alle paar Stunden mit neuem Schlüssel. Wer von Hand
     * einrichtet und beim ersten Kontakt bestätigt, darf danach keine Warnung
     * „Zertifikat geändert“ sehen, solange die Wurzel dieselbe ist.
     */
    @Test
    fun `ein erneuertes Blatt unter der bestaetigten Wurzel gilt ohne neue Frage`() {
        starte(ERNEUERT_BLATT1_KEY, listOf(ERNEUERT_BLATT1, ERNEUERT_WURZEL))
        assertFalse(hole(system(FREMD)))
        val f = frage.offen.value!!
        assertEquals(ZertifikatUngeklaert.Art.UNBEKANNTE_CA, f.art)
        assertEquals(spkiFingerabdruck(zert(ERNEUERT_WURZEL)), f.fingerabdruck)
        assertTrue(frage.bestaetige(pins, abgeschrieben()))
        assertTrue(hole(system(FREMD)))

        // Derselbe Server nach der Erneuerung; ein neuer Testserver braucht einen
        // neuen Port, der bestätigte Pin zieht mit.
        val pin = pins.pin(eigener())!!
        server.shutdown()
        server = MockWebServer()
        starte(ERNEUERT_BLATT2_KEY, listOf(ERNEUERT_BLATT2, ERNEUERT_WURZEL))
        pins.merkePin(eigener(), pin)
        assertTrue("Das neue Blatt unter derselben Wurzel gilt", hole(system(FREMD)))
        assertNull("Keine Warnung nach einer gewöhnlichen Erneuerung", frage.offen.value)
    }

    /**
     * Let's Encrypt sendet Blatt und Zwischenstelle, die Wurzel kennt das System.
     * Gepinnt wird die Wurzel: Wechselt die CA die Zwischenstelle, fragt die App
     * nicht neu — sonst lernte man, „Zertifikat geändert“ wegzutippen.
     */
    @Test
    fun `eine oeffentliche CA bietet ihre Wurzel an, eine neue Zwischenstelle fragt nicht neu`() {
        starte(OEFF_BLATT_A_KEY, listOf(OEFF_BLATT_A, OEFF_ZW_A))
        assertFalse(hole(system(OEFF_WURZEL)))
        val f = frage.offen.value!!
        assertEquals(ZertifikatUngeklaert.Art.ERSTKONTAKT, f.art)
        assertEquals(OEFF_WURZEL_HEX, fingerabdruckLesbar(f.fingerabdruck))
        assertTrue(frage.bestaetige(pins))
        assertTrue(hole(system(OEFF_WURZEL)))

        val pin = pins.pin(eigener())!!
        server.shutdown()
        server = MockWebServer()
        starte(OEFF_BLATT_B_KEY, listOf(OEFF_BLATT_B, OEFF_ZW_B))
        pins.merkePin(eigener(), pin)
        assertTrue("Neue Zwischenstelle unter derselben Wurzel", hole(system(OEFF_WURZEL)))
        assertNull(frage.offen.value)
        assertFalse("Ohne das System gilt der Wurzel-Pin nicht", hole(system(FREMD)))
    }

    @Test
    fun `ein geaenderter Schluessel gilt erst mit abgeschriebenem Fingerabdruck`() {
        starte()
        pins.merkePin(eigener(), spkiFingerabdruck(zert(FREMD)))
        assertFalse(hole(system(ROOT)))
        val f = frage.offen.value!!
        assertEquals(ZertifikatUngeklaert.Art.GEAENDERT, f.art)
        val hex = fingerabdruckLesbar(f.fingerabdruck)

        assertFalse("Ein Tipp genügt nicht", frage.bestaetige(pins))
        assertFalse("Vier Zeichen genügen nicht", frage.bestaetige(pins, hex.takeLast(5)))
        assertFalse("16 Zeichen (64 Bit) genügen nicht", frage.bestaetige(pins, hex.takeLast(23)))
        assertFalse("23 Zeichen genügen nicht", frage.bestaetige(pins, hex.replace(":", "").takeLast(23)))
        assertFalse("Falsche Zeichen", frage.bestaetige(pins, "00:11:22:33:44:55:66:77"))
        assertEquals("Der alte Pin bleibt", spkiFingerabdruck(zert(FREMD)), pins.pin(eigener()))
        assertEquals("Die Frage bleibt offen", f, frage.offen.value)

        assertTrue(frage.bestaetige(pins, hex.takeLast(35).lowercase()))
        assertNull(frage.offen.value)
        assertTrue(hole(system(ROOT)))
    }

    @Test
    fun `ohne bekannte CA genuegt ein Tipp nicht, der Fingerabdruck wird abgeschrieben`() {
        starte()
        assertFalse(hole(system(FREMD)))
        val f = frage.offen.value!!
        assertEquals(ZertifikatUngeklaert.Art.UNBEKANNTE_CA, f.art)

        assertFalse("Ein Tipp genügt nicht", frage.bestaetige(pins))
        assertFalse("Falsche Zeichen", frage.bestaetige(pins, "00:11:22:33:44:55:66:77"))
        assertNull("Nichts gemerkt", pins.pin(eigener()))
        assertFalse("Ohne Pin geht nichts hinaus", hole(system(FREMD)))
        assertEquals(0, server.requestCount)

        assertTrue(frage.bestaetige(pins, abgeschrieben()))
        assertTrue(hole(system(FREMD)))
    }

    @Test
    fun `beim Erstkontakt mit gueltiger Kette genuegt der Vergleich`() {
        starte()
        assertFalse(hole(system(ROOT)))
        assertEquals(ZertifikatUngeklaert.Art.ERSTKONTAKT, frage.offen.value?.art)
        assertTrue("Die Kette hat das System geprüft", frage.bestaetige(pins))
    }

    /** Den Vergleichswert hat openssl gerechnet, unabhängig von der App. */
    @Test
    fun `der Fingerabdruck steht da wie in der Webapp`() {
        assertEquals(ERNEUERT_WURZEL_HEX, fingerabdruckLesbar(spkiFingerabdruck(zert(ERNEUERT_WURZEL))))
    }

    @Test
    fun `ein fremdes Blatt mit angehaengter echter Zwischenstelle passt nicht`() {
        val pin = spkiFingerabdruck(zert(INTER))
        assertTrue(passtZumPin(arrayOf(zert(LEAF), zert(INTER)), pin))
        assertFalse(passtZumPin(arrayOf(zert(FREMD), zert(INTER)), pin))
        assertFalse(passtZumPin(arrayOf(zert(LEAF), zert(INTER)), spkiFingerabdruck(zert(FREMD))))
    }

    @Test
    fun `fremde Hosts prueft nur die Kette`() {
        starte()
        assertTrue(hole(system(ROOT), eigen = "brick.example.org:443"))
        assertNull(frage.offen.value)
        assertFalse(hole(system(FREMD), eigen = "brick.example.org:443"))
        assertNull("Für fremde Hosts gibt es nichts zu bestätigen", frage.offen.value)
    }

    /** Nutzer-CA ist hier ROOT, das System kennt nur FREMD. */
    @Test
    fun `Nutzer-CAs gelten nur fuer den eigenen Server, nie fuer fremde Hosts`() {
        starte()
        val mitNutzerCa = WahlVertrauen(system = system(FREMD), mitNutzer = lazy { system(ROOT) }, nutzerErlaubt = { true })
        assertFalse("Ein fremder Host nimmt eine Nutzer-CA an",
            hole(mitNutzerCa, eigen = "brick.example.org:443", fremd = system(FREMD)))
        assertEquals(0, server.requestCount)
        assertNull(frage.offen.value)

        assertFalse("Auch mit Nutzer-CA geht ohne Pin nichts hinaus", hole(mitNutzerCa, fremd = system(FREMD)))
        assertEquals("Für den eigenen Server zählt die Nutzer-CA", ZertifikatUngeklaert.Art.NUTZER_CA, frage.offen.value?.art)
    }

    /** Nutzer-CA ist ROOT: Wer sie einschleust, soll nicht mit einem Tipp durchkommen. */
    @Test
    fun `ueber eine Nutzer-CA genuegt beim ersten Kontakt kein Tipp`() {
        starte()
        val mitNutzerCa = WahlVertrauen(system = system(FREMD), mitNutzer = lazy { system(ROOT) }, nutzerErlaubt = { true })
        assertFalse(hole(mitNutzerCa, fremd = system(FREMD)))
        assertEquals(spkiFingerabdruck(zert(ROOT)), frage.offen.value!!.fingerabdruck)
        assertFalse("Ein Tipp genügt nicht", frage.bestaetige(pins))
        assertNull(pins.pin(eigener()))
        assertTrue(frage.bestaetige(pins, abgeschrieben()))
        assertTrue("Danach gilt die gepinnte Nutzer-CA", hole(mitNutzerCa, fremd = system(FREMD)))
    }

    /**
     * Die CA wechselt ihre Wurzel (Let's Encrypt ISRG X1 → X2): Der bestätigte Host
     * bleibt gültig, solange das System die neue Kette annimmt. Ein Pin auf eine
     * eigene CA deckt dagegen keine fremde öffentliche Kette.
     */
    @Test
    fun `ein oeffentlicher Pin uebersteht den Wechsel der Wurzel, ein eigener nicht`() {
        starte(OEFF_BLATT_A_KEY, listOf(OEFF_BLATT_A, OEFF_ZW_A))
        assertFalse(hole(system(OEFF_WURZEL, OEFF2_WURZEL)))
        assertEquals(ZertifikatUngeklaert.Art.ERSTKONTAKT, frage.offen.value?.art)
        assertTrue(frage.bestaetige(pins))

        val pin = pins.pin(eigener())!!
        server.shutdown()
        server = MockWebServer()
        starte(OEFF2_BLATT_KEY, listOf(OEFF2_BLATT))
        pins.merkePin(eigener(), pin)
        assertTrue("Neue Wurzel, öffentlich gültig", hole(system(OEFF_WURZEL, OEFF2_WURZEL)))
        assertNull("Keine Warnung beim Wurzelwechsel", frage.offen.value)
        assertFalse("Ohne System-Gültigkeit kein Durchlass", hole(system(OEFF_WURZEL)))
        assertEquals(ZertifikatUngeklaert.Art.GEAENDERT, frage.offen.value?.art)

        frage.verwerfen()
        pins.merkePin(eigener(), spkiFingerabdruck(zert(ERNEUERT_WURZEL)))
        assertFalse("Eine eigene CA bleibt an ihren Schlüssel gebunden", hole(system(OEFF_WURZEL, OEFF2_WURZEL)))
        assertEquals(ZertifikatUngeklaert.Art.GEAENDERT, frage.offen.value?.art)
        assertEquals("Nur die eine gültige Anfrage kam an", 1, server.requestCount)
    }

    /**
     * Ein Pin auf eine System-Wurzel heisst „öffentlich gültig“, und dazu gehört die
     * CT-Prüfung des Systems. Schickt der Server die Wurzel mit, darf der Abgleich mit
     * dem Pin diese Prüfung nicht ersetzen. Das „System“ hier kennt die Wurzel, lehnt
     * aber jede Kette ab, wie es eine nicht protokollierte Ausstellung täte.
     */
    @Test
    fun `ein Pin auf eine System-Wurzel gilt nur mit der System-Pruefung, auch wenn der Server sie mitschickt`() {
        starte(WURZEL_BLATT_KEY, listOf(WURZEL_BLATT, WURZEL))
        val basis = system(WURZEL)
        val ohneCt = object : X509ExtendedTrustManager() {
            private fun nein(): Nothing = throw java.security.cert.CertificateException("nicht in den CT-Protokollen")
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, s: java.net.Socket?) { nein() }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, e: javax.net.ssl.SSLEngine?) { nein() }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String) { nein() }
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, s: java.net.Socket?) = basis.checkClientTrusted(c, a, s)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, e: javax.net.ssl.SSLEngine?) = basis.checkClientTrusted(c, a, e)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String) = basis.checkClientTrusted(c, a)
            override fun getAcceptedIssuers(): Array<X509Certificate> = basis.acceptedIssuers
        }
        pins.merkePin(eigener(), spkiFingerabdruck(zert(WURZEL)))
        assertFalse("Die mitgeschickte Wurzel ersetzt die System-Prüfung", hole(basis, fremd = ohneCt))
        assertEquals(0, server.requestCount)
        assertEquals(ZertifikatUngeklaert.Art.GEAENDERT, frage.offen.value?.art)

        frage.verwerfen()
        assertTrue("Mit bestandener System-Prüfung gilt der Pin", hole(basis, fremd = basis))
        assertNull(frage.offen.value)
    }

    /** Die Fassung ohne Socket kennt den Host nicht; ein Pin des eigenen Servers gilt trotzdem. */
    @Test
    fun `ohne Host faellt ein gepinnter Server nicht auf die System-CAs zurueck`() {
        val tm = PinVertrauen(system(FREMD), pins, eigenerServer = { "nas:8443" }, frage = frage, fremdeHosts = system(FREMD))
        tm.checkServerTrusted(arrayOf(zert(FREMD)), "ECDHE_ECDSA")
        pins.merkePin("nas:8443", spkiFingerabdruck(zert(INTER)))
        val abgelehnt = runCatching { tm.checkServerTrusted(arrayOf(zert(FREMD)), "ECDHE_ECDSA") }.isFailure
        assertTrue("Eine System-CA ersetzt den Pin nicht", abgelehnt)
        tm.checkServerTrusted(arrayOf(zert(LEAF), zert(INTER)), "ECDHE_ECDSA")
    }

    /** Die Fassung mit Socket, aber ohne Handshake-Sitzung: dieselbe Regel wie ohne Socket. */
    @Test
    fun `ohne Handshake-Sitzung gilt der Pin des eigenen Servers`() {
        val tm = PinVertrauen(system(FREMD), pins, eigenerServer = { "nas:8443" }, frage = frage, fremdeHosts = system(FREMD))
        tm.checkServerTrusted(arrayOf(zert(FREMD)), "ECDHE_ECDSA", null as java.net.Socket?)
        pins.merkePin("nas:8443", spkiFingerabdruck(zert(INTER)))
        val abgelehnt = runCatching {
            tm.checkServerTrusted(arrayOf(zert(FREMD)), "ECDHE_ECDSA", null as java.net.Socket?)
        }.isFailure
        assertTrue("Eine System-CA ersetzt den Pin nicht", abgelehnt)
        tm.checkServerTrusted(arrayOf(zert(LEAF), zert(INTER)), "ECDHE_ECDSA", null as java.net.Socket?)
    }

    /**
     * Eine wiederaufgenommene TLS-Sitzung prüft keine Kette. Nach dem Ausschalten der
     * Nutzer-CAs baut die App den Kontext neu (ServerClient.kt); danach muss eine neue
     * Verbindung wieder geprüft werden.
     */
    @Test
    fun `nach dem Erneuern prueft eine neue Verbindung die Kette wieder`() {
        starte(); server.enqueue(MockResponse().setBody("ok"))
        val basis = system(ROOT)
        var erlaubt = true
        val tm = object : X509ExtendedTrustManager() {
            private fun darf() { if (!erlaubt) throw java.security.cert.CertificateException("entzogen") }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, s: java.net.Socket?) {
                darf(); basis.checkServerTrusted(c, a, s)
            }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, e: javax.net.ssl.SSLEngine?) {
                darf(); basis.checkServerTrusted(c, a, e)
            }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String) { darf(); basis.checkServerTrusted(c, a) }
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, s: java.net.Socket?) = basis.checkClientTrusted(c, a, s)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, e: javax.net.ssl.SSLEngine?) = basis.checkClientTrusted(c, a, e)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String) = basis.checkClientTrusted(c, a)
            override fun getAcceptedIssuers(): Array<X509Certificate> = basis.acceptedIssuers
        }
        val fabrik = ch.brickinventoryapp.util.ErneuerbareTlsFabrik {
            SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }.socketFactory
        }
        val c = OkHttpClient.Builder().sslSocketFactory(fabrik, tm)
            .connectTimeout(2, TimeUnit.SECONDS).readTimeout(2, TimeUnit.SECONDS).build()
        fun hole() = try {
            c.newCall(Request.Builder().url(server.url("/api/v1/sets")).build()).execute().use { it.isSuccessful }
        } catch (_: IOException) { false }
        assertTrue(hole())
        c.connectionPool.evictAll()
        erlaubt = false
        fabrik.erneuere()
        assertFalse("Die alte Sitzung wurde ohne Prüfung wieder aufgenommen", hole())
    }

    /** Der Dialog zeigt vor dem Abtippen nur den Anfang; das Abzutippende steht nicht da. */
    @Test
    fun `der gezeigte Anfang verraet nichts vom abzutippenden Teil`() {
        val fp = spkiFingerabdruck(zert(ERNEUERT_WURZEL))
        val anfang = fingerabdruckAnfang(fp)
        assertTrue(anfang, anfang.startsWith("8E:04:B3:9F"))
        val gezeigt = anfang.uppercase().filter { it in "0123456789ABCDEF" }
        assertEquals(8, gezeigt.length)
        assertFalse(ERNEUERT_WURZEL_HEX.replace(":", "").takeLast(24).contains(gezeigt))
        assertFalse("Der Anfang allein bestätigt nichts", bestaetigtFingerabdruck(anfang, fp))
    }

    @Test
    fun `der Pin gilt je Host und Port, nur fuer https`() {
        assertEquals("brick.example.org:443", pinSchluessel("https://Brick.Example.org/"))
        assertEquals("nas:8443", pinSchluessel("https://nas:8443/brick"))
        assertNull(pinSchluessel("http://nas:3000"))
    }

    @Test
    fun `ein QR-Code traegt den Fingerabdruck mit`() {
        val fp = spkiFingerabdruck(zert(LEAF))
        val p = parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc","fp":"$fp"}""")!!
        assertEquals(fp, p.fingerabdruck)
        assertNull(parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc"}""")!!.fingerabdruck)
    }

    @Test
    fun `ein QR-Code mit unlesbarem Fingerabdruck gilt nicht`() {
        assertNull(parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc","fp":"kurz"}"""))
        val fp = spkiFingerabdruck(zert(LEAF))
        assertNull("Ein Pin über http ergibt nichts", parseQrPayload("""{"url":"http://nas:3000","token":"bim:abc","fp":"$fp"}"""))
        assertNull(parseQrPayload("""{"url":"https://nas","token":"fremd"}"""))
    }

    private companion object {
        val PW = "test".toCharArray()
        fun zert(b64: String): X509Certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(Base64.getDecoder().decode(b64).inputStream()) as X509Certificate

        const val ROOT = "MIIBlTCCATugAwIBAgIUCbgn7Upu9fEAMGToKKauXo+baGUwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAXMRUwEwYDVQQDDAxCcmljayBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR8FJcl3BEyvVpJgfQ/T5qw/+pweuS6179KUZKyiCZGxiBp5q11Lyk/Z/qZ3lYWC8vf5F1vn/BNqU7bbKB3HhkPo2MwYTAdBgNVHQ4EFgQUXGDtWh02N49g+YF9OEkqvnoC1EgwHwYDVR0jBBgwFoAUXGDtWh02N49g+YF9OEkqvnoC1EgwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhALnFIf/TxItrcCD4WHUT6D3XfqsMqHQ8Rx7Qjc7304s4AiADtT8yG+NtvZHTDM/cmC/eJWf/LsA1xnJTA5yXuGlxzg=="
        const val INTER = "MIIBlzCCAT2gAwIBAgIUQyjZ8Us4p6zbuUu9OD8NEe+rg0IwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAZMRcwFQYDVQQDDA5CcmljayBad2lzY2hlbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKHmNbAOfGEGwyrPGQynBjdkBGW5x/8pNc/Lcpad3cW5GqsvY5WChv5QSJhnj/3jWqC/9hIcIgoOR6w1OsgpN16jYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBS/HkuEroFohODqD2wk4HPnlSdDQDAfBgNVHSMEGDAWgBRcYO1aHTY3j2D5gX04SSq+egLUSDAKBggqhkjOPQQDAgNIADBFAiAb/nz4SUy5/d2t/ci7w0eBD9c7HadJ4CcVtCs4ugUuFwIhAJAxMmuBap9q2jYYNRmSymGdOBt78fT12KETYQ4uWnaO"
        const val LEAF = "MIIBxDCCAWqgAwIBAgIUGKFt31uRyQEpo2/dyXJUnyNBQvQwCgYIKoZIzj0EAwIwGTEXMBUGA1UEAwwOQnJpY2sgWndpc2NoZW4wIBcNMjYxMDMwMTU0MjU4WhgPMjEyNjEwMDYxNTQyNThaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMRphX3E9F+1CxrClvKYvhQLC1GyRMM0KV6hemBqhqJ4ErxTmWWsCmCaLxc9ai0HRRVGcwRaTUYN2zwUwOruxrqjgZIwgY8wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwEwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMB8GA1UdIwQYMBaAFL8eS4SugWiE4OoPbCTgc+eVJ0NAMB0GA1UdDgQWBBTYiTrV8idg50suxhBOzVR4ehDuXjAKBggqhkjOPQQDAgNIADBFAiEAqVWMQNoCR/Qv0iDKhwjlSmbIpcj4QkkvEwOLQJjmWVkCIHbT27kp+E5rJEcyBRHjRi8lrrqHGMcGJY3hZQXm0rOc"
        /** Nur für diesen Test erzeugt; schützt nichts. */
        /** Caddy sign_with_root: Blatt direkt von der Wurzel signiert (openssl, 30.10.2026). */
        const val WURZEL = "MIIBlTCCATugAwIBAgIUWfsD4SFXkS/uYDWYXA+OWZbAS0owCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAXMRUwEwYDVQQDDAxDYWRkeSBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASudcnAk+7NFzlNgXJlzLpv1WNLgSrYkYdxzHKOI9CAGktSDWCmqhJfXKbJezy/XJtJhb8No+g98CcCX+K4RZ7wo2MwYTAdBgNVHQ4EFgQULpDKa+iFWhIS/Vl4s94pdZYH43QwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgDuvgqOOE7zjj0LE3ZMADdJ6CbM9zLc9uZyPLXQIcJ24CIQDvseM//f4Ymtat2eDiE0guayf6MFBXQwVmUEAs/h5jsA=="
        const val WURZEL_BLATT = "MIIBwjCCAWigAwIBAgIUJ5bQK16akXTtVJGiddkeeCeimhAwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwHo4GSMIGPMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUAZczQX6xjqiWuzi8ceAiL8aMRSgwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwCgYIKoZIzj0EAwIDSAAwRQIhAIDDuQsj3wEuClpl1bZMDbJQ1fnXG3pDWbfkcK9Nbkj1AiAoe+I71U9V5jog/wz5Y5bOc2YbEAw1q+grLMsqMP1jUA=="
        const val WURZEL_BLATT_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqZs7tPJIE6CpMc2pY0PdwG3yxUHoNpKYXMHNMTymB+KhRANCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwH"
        const val LEAF_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg84oF2kTvPuV0IbWxEBoJyR56Fy+0F8JahbFGp5BLWNyhRANCAATEaYV9xPRftQsawpbymL4UCwtRskTDNCleoXpgaoaieBK8U5llrApgmi8XPWotB0UVRnMEWk1GDds8FMDq7sa6"
        /** Eine Wurzel mit zwei Blättern verschiedener Schlüssel: die Erneuerung bei Caddy. */
        const val ERNEUERT_WURZEL = "MIIBpzCCAU2gAwIBAgIUJTOasEJOl0Pf7j0Qu01Sy8psgtYwCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVQ2FkZHkgV3VyemVsIEVybmV1ZXJ0MCAXDTI2MTEwMTA3MjY1MVoYDzIxMjYxMDA4MDcyNjUxWjAgMR4wHAYDVQQDDBVDYWRkeSBXdXJ6ZWwgRXJuZXVlcnQwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATiMyAJAa2zn6z/XzWP4N3gXVIwrNsjX3N7XNaRTwZl+kMBDrdiCWGvXlzeW4SlhxzXNuRKMVZspa9oLozWu4Ylo2MwYTAdBgNVHQ4EFgQUqmjAp54LnvWA/rxJuUqmA46NfbUwHwYDVR0jBBgwFoAUqmjAp54LnvWA/rxJuUqmA46NfbUwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhAKkqowjQxkTgYQT0X1D1/pH9AqbLfH4GRWLX/6l6x65yAiAvBcvxLwaniZ8UBE66GQyRR7OQqpBWiCvnVItju+uT7A=="
        const val ERNEUERT_WURZEL_HEX = "8E:04:B3:9F:BF:A3:2D:A2:18:32:DB:2F:50:22:4C:2D:DE:96:AF:3A:0E:CA:01:05:95:E8:5F:1E:00:69:84:AB"
        const val ERNEUERT_BLATT1 = "MIIBxzCCAW6gAwIBAgIUNED1j2vQniFdnw4NBBoyn5y9NsswCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVQ2FkZHkgV3VyemVsIEVybmV1ZXJ0MCAXDTI2MTEwMTA3MjY1MVoYDzIxMjYxMDA4MDcyNjUxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARo3O3gBYVKoZ258LnBNzokFNZYa9re0sQVASwdqdtSNmwkXYr3Oin1u7J8CHuUKU5Wnj239xhxTcysx1s75gkAo4GPMIGMMAkGA1UdEwQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUvoABbHxaUxwgnYAuitc4oBTOhSYwHwYDVR0jBBgwFoAUqmjAp54LnvWA/rxJuUqmA46NfbUwCgYIKoZIzj0EAwIDRwAwRAIgJd7x9uBMAYsvqpKWq3OPtjOWKNHFEDca2A6bL+jKAigCIGwQ/YZBhOwuQgG9IZYsbsN/WOVzMgL0kInoq8EnJdFr"
        const val ERNEUERT_BLATT1_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQghRyFpO/jlqgF52U0y5wFGuYiEhYlqjn1ua2/I+YlOlKhRANCAARo3O3gBYVKoZ258LnBNzokFNZYa9re0sQVASwdqdtSNmwkXYr3Oin1u7J8CHuUKU5Wnj239xhxTcysx1s75gkA"
        const val ERNEUERT_BLATT2 = "MIIByTCCAW6gAwIBAgIUNED1j2vQniFdnw4NBBoyn5y9NswwCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVQ2FkZHkgV3VyemVsIEVybmV1ZXJ0MCAXDTI2MTEwMTA3MjY1MVoYDzIxMjYxMDA4MDcyNjUxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARW/sryEYeErhUzXKqmM/ZH8rtumVlk4/NOugkM98U5wWirXfFozbsceyOHTb6cZdwtsOb+R3MjM1T8yhe8ZBHYo4GPMIGMMAkGA1UdEwQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUrufLzJG5jvOE0ZNVIgUuFsKOjt8wHwYDVR0jBBgwFoAUqmjAp54LnvWA/rxJuUqmA46NfbUwCgYIKoZIzj0EAwIDSQAwRgIhALePJ9a9k9vdjKBxDuPGn9kIP5juXHCBuHjy49hb5EH1AiEA/qkkQkBKdBYF7ECQnwAnobnpIyIcGyfQ/MN1UO/z2dE="
        const val ERNEUERT_BLATT2_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSfcmm6eyJEzmbUxAk9UHevRKVQMhEqMn242fIEhY7aWhRANCAARW/sryEYeErhUzXKqmM/ZH8rtumVlk4/NOugkM98U5wWirXfFozbsceyOHTb6cZdwtsOb+R3MjM1T8yhe8ZBHY"
        /** Öffentliche CA im Kleinen: eine Wurzel, zwei Zwischenstellen mit je einem Blatt (openssl, 01.11.2026). */
        const val OEFF_WURZEL = "MIIBpDCCAUmgAwIBAgIUZIFCnfxNIQRpMPTNwW7BSSFDv80wCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMYW+yzOBBNjAat0l/sP4W3ZgRVDK5kCmFCH5Dv7185TkPr5k7scjn/974EXTVvZDYU1LPsZmW3gXy0FNGysUC+jYzBhMB0GA1UdDgQWBBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNJADBGAiEAp6GVM9JkGHL6UnRaaidFdJ2KXTkT5dVarFiyfXTEfDACIQDl6sX2VT243lSNJtFFpU3znF+GxV7T8KstC/lIGpQA/g=="
        const val OEFF_WURZEL_HEX = "F4:5D:D3:BE:46:44:4D:61:F1:CD:DE:03:92:B3:C5:8A:73:F3:33:DC:60:9D:AC:42:BD:C0:BB:CC:FE:19:E0:FB"
        const val OEFF_ZW_A = "MIIBoDCCAUagAwIBAgIUAQU1sXdBgqFF38Hi+ijuOG1hvwYwCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABOWdioVQKAOBRw6UiEyIXBhIl95junXb8p6oGzTDkKJWw4zE7efq82EiL0JrvnkWQziXaTCAzYqVk3xnwHqv4KSjYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBTQ5IolVueozviLke93UtJ6G3Y0EDAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAKBggqhkjOPQQDAgNIADBFAiEA/5LLzEGDA7tkDnrGKtFmUDSyWyNizCD47OaVWdjPKjsCIFH/YtymGArW/cxrFfMpLjvPzmV3bh2fen18oGROYQLj"
        const val OEFF_ZW_B = "MIIBnzCCAUagAwIBAgIUAQU1sXdBgqFF38Hi+ijuOG1hvwcwCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABDEgpbf+s6SGWZj/quaQtakWiv4xWus5vjua3ax1UXeC9LoJh5UtlfkGbQ2wXR3EFesZjh3BGkrJhJY0asO6VkijYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBQ/oP7MODYtWp9Gyzs6MtDPBmJIMDAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAKBggqhkjOPQQDAgNHADBEAiAK9OlzxqHfohUqtdRNpFUoOF4gPAqXPhPhlObB0JtBgQIgIZ0y638KPcdq6B1hVzLB3YARfLe32J/MhJExn8bcWKk="
        const val OEFF_BLATT_A = "MIIBxjCCAWygAwIBAgIUEBLGo7NHqNVaaJN74wAlRIwi4W4wCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYTAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjqRhSfxnpKW8SVpXa+tPaRt6Vlwq2CmtlrBmms1LDiwh0W5nor0jmmIAf+DK2BrKpAgzdtTPsylxmTjIGpnezqOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFOw0VRfHzwggapzdIqYWyzwb8jflMB8GA1UdIwQYMBaAFNDkiiVW56jO+IuR73dS0nobdjQQMAoGCCqGSM49BAMCA0gAMEUCIQDYuBBmG4miA9O95DWJ35JamLrl6Hiz9MlCl3EzYekrRwIgebgFsZ6Ob4etGqT4Bk/zA2N4eMcO9yAtUeQrQ04sNsU="
        const val OEFF_BLATT_A_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgHVYb+/H8EyhvizzUS3y9TAt7FlkQtQTQ67/8+ih/YaihRANCAASOpGFJ/GekpbxJWldr609pG3pWXCrYKa2WsGaazUsOLCHRbmeivSOaYgB/4MrYGsqkCDN21M+zKXGZOMgamd7O"
        const val OEFF_BLATT_B = "MIIBxjCCAWygAwIBAgIUMZo/EI4H/XOHp4BTSLv9bt1IR58wCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYjAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2E8WBySJmiIWknMzbepPni3bP68iZpP3c2WwBCqoEMZb8ppgaIFnfP4x8FfQwxmbblOfnAK9qIpIMMOKcqJLhKOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFG5BwbuRc8QPiyQocRkuaHnm7J03MB8GA1UdIwQYMBaAFD+g/sw4Ni1an0bLOzoy0M8GYkgwMAoGCCqGSM49BAMCA0gAMEUCIQCvJtbBc2pqUGlh8evmznKK1G/O8iW531jJlET2gYW5KwIgDINFCTJgae8SPreE2VipqiyzSncwBRglIT3Sw1EcC6M="
        const val OEFF_BLATT_B_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg7LsVCGLBPHR5qR7tBe+zQWeT/RemLJNrPJ7SFpGNHwyhRANCAATYTxYHJImaIhaSczNt6k+eLds/ryJmk/dzZbAEKqgQxlvymmBogWd8/jHwV9DDGZtuU5+cAr2oikgww4pyokuE"
        /** Eine zweite öffentliche Wurzel mit Blatt, für den Wurzelwechsel (openssl, 02.11.2026). */
        const val OEFF2_WURZEL = "MIIBqDCCAU2gAwIBAgIUeQfiSvXaOs9VQ7JOTGuYq9+9io8wCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVT2VmZmVudGxpY2hlIFd1cnplbCAyMCAXDTI2MTEwMjA0NDcyMFoYDzIxMjYxMDA5MDQ0NzIwWjAgMR4wHAYDVQQDDBVPZWZmZW50bGljaGUgV3VyemVsIDIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARXPBIUHUcx0gndNtCFWOsc9VK1UCPYVdTt/elmdGtOr+QqU+2kj82x5bM5PwwxyeTMI0l/0m7+IhRHasjTD3wAo2MwYTAdBgNVHQ4EFgQUNiOkY9V+q2qKkLNO3YzYDvJSMtgwHwYDVR0jBBgwFoAUNiOkY9V+q2qKkLNO3YzYDvJSMtgwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSQAwRgIhAOtFyStygsxuZ82WUpQfgs4yEc9yd5SHXzEeM5gxXWiHAiEAxq1QdZDQEZLbpSZkktaMa/gUng+ruXUCb7bbSSw+VW4="
        const val OEFF2_BLATT = "MIIByjCCAXGgAwIBAgIUBZldxIW8pDuyAwDmNEUH+CvVA/8wCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVT2VmZmVudGxpY2hlIFd1cnplbCAyMCAXDTI2MTEwMjA0NDcyMFoYDzIxMjYxMDA5MDQ0NzIwWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR3UZCup1reCVwcdpUWXuBroLN2Ae2orBEjO/63RFn9ppwOTZcXNQbuX2J20HqKFM7F5pgpPdZWoCx5CuuTDLkco4GSMIGPMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQU0+JHa2fUKgS1c8Qpf2MPvkf10x0wHwYDVR0jBBgwFoAUNiOkY9V+q2qKkLNO3YzYDvJSMtgwCgYIKoZIzj0EAwIDRwAwRAIgaI3NXaJqaJPF9F3F5MA/uHYXmLEMDGlz2rerz62IXIACIGGccRCorHmF04MB3oFogbyx7s3cjhOWNIM2PivVGTsj"
        const val OEFF2_BLATT_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgkJUGxWpt9r1Mxq/Kodx7mWejKYEWCr0nz2zAkQCUrm2hRANCAAR3UZCup1reCVwcdpUWXuBroLN2Ae2orBEjO/63RFn9ppwOTZcXNQbuX2J20HqKFM7F5pgpPdZWoCx5CuuTDLkc"
        const val FREMD ="MIIBmDCCAT6gAwIBAgIUBpLM0+8DZR9WqDw7DqtrEKH9KDswCgYIKoZIzj0EAwIwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATSAfTFPtfDF3dy0bcjX8dCElM9oKs2NYwoZEyfWsb5EIpbYtqP7F6JCLbrsb7GVytdEqsatNJDifymfYNnIJPjo2wwajAdBgNVHQ4EFgQU5NOS8aVLD/bPQjWQ5foWE5AcTIQwHwYDVR0jBBgwFoAU5NOS8aVLD/bPQjWQ5foWE5AcTIQwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMAwGA1UdEwEB/wQCMAAwCgYIKoZIzj0EAwIDSAAwRQIgD2hCTe+02K17PzDfV7EgrTEgIV1C99ShlLSwHZsc1IICIQCknNnfSKSNOc+Kilyyna8ag4H9A8XH9kfcAia1XVWbDg=="
    }
}
