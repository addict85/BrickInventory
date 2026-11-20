package ch.brickinventoryapp.anmeldung

import ch.brickinventoryapp.anmeldung.ui.parseQrPayload
import ch.brickinventoryapp.sicherheit.PinStore
import ch.brickinventoryapp.sicherheit.PinTrust
import ch.brickinventoryapp.sicherheit.ChoiceTrust
import ch.brickinventoryapp.sicherheit.CertificateUnresolved
import ch.brickinventoryapp.sicherheit.CertificateQuestion
import ch.brickinventoryapp.sicherheit.Transcript
import ch.brickinventoryapp.sicherheit.CA_FAMILIES
import ch.brickinventoryapp.sicherheit.sheetPinKey
import ch.brickinventoryapp.sicherheit.fingerprintStart
import ch.brickinventoryapp.sicherheit.fingerprintReadable
import ch.brickinventoryapp.sicherheit.fitsToPin
import ch.brickinventoryapp.sicherheit.pinKey
import ch.brickinventoryapp.sicherheit.spkiFingerprint
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
import ch.brickinventoryapp.netz.util.RenewableTlsFactory
import java.net.Socket
import java.security.cert.CertificateException
import javax.net.ssl.SSLEngine

/**
 * Pinning des eigenen Servers, über echtes TLS gegen einen Testserver: Wurzel →
 * Zwischenstelle → Blatt „localhost“, dazu ein fremdes selbst signiertes Blatt.
 * Die Zertifikate sind feste Testdaten (100 Jahre gültig).
 *
 * Gegenproben:
 *   A  in pruefe() ohne Pin `return kettenPruefung()` statt nachzufragen → rot
 *      „ohne Pin geht beim ersten Kontakt nichts hinaus“
 *   B  fitsToPin() nur `indexOfFirst >= 0` (ohne Pfadprüfung) → rot „ein
 *      fremdes Blatt mit angehängter echter Zwischenstelle passt nicht“
 *   C  bei abweichendem Pin `return` statt zu melden → rot „ein anderer
 *      Schlüssel unter dem gemerkten Pin wird nicht still angenommen“
 *   D  der Vergleich mit ownServer() entfernt (alle Hosts gepinnt) → rot
 *      „fremde Hosts prüft nur die Kette“
 *   E  parseQrPayload() übernimmt ein unlesbares fp → rot „ein QR-Code mit
 *      unlesbarem Fingerabdruck gilt nicht“
 *   F  in pruefe() wieder `chain[0]` statt `chain.last()` → rot
 *      „ohne Pin geht beim ersten Kontakt nichts hinaus …“ (Blatt statt
 *      Zwischenstelle) und „ein erneuertes Blatt unter der bestätigten Wurzel …“
 *      (nach der Erneuerung GEAENDERT)
 *   G  fingerprintReadable() wieder in Vierergruppen → rot „der
 *      Fingerabdruck steht da wie in der Webapp“
 *   H  in pruefe() fremde Hosts wieder mit `kette` statt
 *      `foreignHosts` → rot „Nutzer-CAs gelten nur fuer den eigenen Server …“
 *   I  in pruefe() wieder `spkiFingerprint(chain.last())` statt der Wurzel
 *      aus dem System → rot „eine oeffentliche CA bietet ihre Wurzel an …“
 *      und „ohne Pin geht beim ersten Kontakt nichts hinaus …“
 *   J  in CertificateQuestion.bestaetige() die Bedingung für GEAENDERT entfernt →
 *      rot „ein geaenderter Schluessel gilt erst mit abgeschriebenem …“
 *   K  bestaetigtFingerabdruck() mit `>= 4` statt `>= 16` → rot „ein
 *      geaenderter Schluessel …“ (vier getippte Zeichen genügten); ebenso
 *      FINGERPRINT_TYPE_IN = 16 statt 24 → rot dort („16 Zeichen (64 Bit) …“)
 *   L  in bestaetige() wieder nur GEAENDERT prüfen (`f.art == GEAENDERT &&`)
 *      → rot „ohne bekannte CA genuegt ein Tipp nicht …“
 *   M  die Zeile `if (pin != null && oeffentlich && pin in
 *      systemRoots) return` entfernt → rot „eine oeffentliche CA …“, „ein
 *      geaenderter Schluessel …“ (Stand vor dem Wurzel-Pin, siehe X)
 *   N  dort ohne `&& pin in systemRoots` → rot „ein oeffentlicher Pin …“
 *      („Eine eigene CA bleibt an ihren Schlüssel gebunden“) und „ein anderer
 *      Schluessel unter dem gemerkten Pin …“
 *   O  `viaUserCa -> NUTZER_CA` wieder ERSTKONTAKT → rot „ueber eine
 *      Nutzer-CA genuegt …“ („Ein Tipp genügt nicht“) und „Nutzer-CAs gelten …“
 *   P  in checkServerTrusted ohne Socket `if (!fitsToPin(chain, pin))` →
 *      `if (pin.isEmpty())` → rot „ohne Host faellt ein gepinnter Server …“
 *   Q  fingerprintStart() ohne `.take(11)` → rot „der gezeigte Anfang …“
 * Gegenproben:
 *   R  in pruefe() ohne Handshake-Sitzung wieder `mit(foreignHosts)` → rot „ohne
 *      Handshake-Sitzung gilt der Pin des eigenen Servers“
 *   S  RenewableTlsFactory.erneuere() ohne Wirkung → rot „nach dem Erneuern prueft
 *      eine neue Verbindung die Kette wieder“ (die Sitzung wurde wiederaufgenommen)
 * Gegenprobe:
 *   T  in pruefe() wieder `if (pin != null && fitsToPin(chain, pin)) return` (auch
 *      für eine System-Wurzel) → rot „ein Pin auf eine System-Wurzel gilt nur mit der
 *      System-Pruefung …“; gegenproben/wurzelpin-ohne-ct.patch
 * Gegenproben zum Pin aus dem gescannten Code (lokal gemessen):
 *   U  in pruefe() wieder `if (publicPin && oeffentlich) return` (ohne
 *      `!fromCode`) → rot „ein Code mit System-Wurzel muss genau diese Wurzel …“;
 *      gegenproben/code-wurzel-ungeprueft.patch
 *   V  in bestaetige() die Zeile für CODE_ABWEICHUNG entfernt → rot „ein Code mit
 *      System-Wurzel …“ (abgetippt bestätigt); gegenproben/code-abweichung-bestaetigbar.patch
 *   W  bei abweichendem Pin immer GEAENDERT → rot „ein Code mit eigener CA …“;
 *      gegenproben/code-abweichung-als-rueckfrage.patch
 * Gegenproben zum öffentlichen Pin (12.11.2026, kotlinc gegen ServerVertrauen.kt):
 *   X  carriesPin() wieder `situation.oeffentlich && (!fromCode || …)` (jede öffentliche Kette) →
 *      rot „ein oeffentlicher Pin haelt eine Kette unter fremder Wurzel an …“;
 *      gegenproben/oeffentlicher-pin-jede-wurzel.patch
 *   Y  in carriesPin() und withoutHost() ohne sameOperator() → rot „eine neue Wurzel
 *      desselben Betreibers …“ und „ohne Host gilt ein oeffentlicher Pin …“;
 *      gegenproben/wurzelfamilie-fragt-neu.patch
 *   Z  withoutHost() wieder `pin in systemRoots → system()` → rot „ohne Host gilt ein
 *      oeffentlicher Pin …“; gegenproben/ohne-host-jede-wurzel.patch
 * Gegenproben zur Abschrift (12.11.2026, kotlinc):
 *   AA in Abschrift.von() zu kurz wieder FITS_NOT → rot „eine Abschrift mit
 *      Doppelpunkten ist zu kurz …“; gegenproben/abschrift-zu-kurz-unerkannt.patch
 *   (Die Doppelpunkte beim Tippen prüft core-ui, AbschriftformTest.)
 * Gegenproben zum zweiten Pin und zu den CA-Familien (14.11.2026, kotlinc gegen
 * ServerVertrauen.kt, JUnit lokal):
 *   AB in pruefe() wieder `if (carriesPin(…)) return` ohne checkSheet() → rot „ein neuer
 *      Serverschluessel unter derselben oeffentlichen Wurzel …“;
 *      gegenproben/blattpin-ungeprueft.patch
 *   AC sameOperator() wieder über das O= im Subjekt → rot „dasselbe O= im Subjekt
 *      macht noch keine Familie …“; gegenproben/familie-nach-subjekt.patch
 *   AD in bestaetige() das Abtippen beim Erstkontakt nicht geprüft (`freiwillig` auch mit
 *      Eingabe) → rot „beim Erstkontakt darf man abtippen …“;
 *      gegenproben/erstkontakt-abschrift-ungeprueft.patch
 *   AE in checkSheet() `|| fromCode` gestrichen → rot „ein Code vom angemeldeten Bildschirm
 *      tauscht den Serverschluessel …“; gegenproben/blattpin-code-fragt.patch
 * Gegenproben zum neuen Serverschlüssel ohne CT-Pflicht (Prüfung 476e4a4, M1; CI):
 *   AF transcriptNeeded für SCHLUESSEL_NEU wieder `false` → rot „ein neuer Serverschluessel
 *      unter derselben oeffentlichen Wurzel …“ („Ohne CT-Pflicht genügt ein Tipp nicht“);
 *      gegenproben/schluessel-neu-ein-tipp.patch
 *   AG checkSheet() reicht ctForced nicht weiter → rot „mit CT-Pflicht genuegt …“;
 *      gegenproben/schluessel-neu-ohne-ct-wissen.patch
 * Gegenproben zum Erstkontakt ohne CT-Pflicht (Tiefprüfung A-S-5; kotlinc, JUnit lokal):
 *   AH transcriptNeeded für ERSTKONTAKT wieder `false` → rot „ohne CT-Pflicht genuegt beim
 *      Erstkontakt kein Tipp …“; gegenproben/erstkontakt-ein-tipp-ohne-ct.patch
 *   AI pruefe() meldet den Erstkontakt ohne ctForced → rot „beim Erstkontakt mit
 *      CT-Pflicht genuegt der Vergleich“; gegenproben/erstkontakt-ohne-ct-wissen.patch
 */
class CertificatePinTest {

    private var server = MockWebServer()
    private val frage = CertificateQuestion()
    private val pins = object : PinStore {
        val map = mutableMapOf<String, String>()
        override fun pin(schluessel: String) = map[schluessel]
        override fun rememberPin(schluessel: String, fingerabdruck: String) { map[schluessel] = fingerabdruck; fromCode.remove(schluessel) }
        /** Wie DevicesStore.holdBefore: gilt, ist aber noch nicht bestätigt. */
        val fromCode = mutableSetOf<String>()
        fun holdBefore(schluessel: String, fingerabdruck: String) { map[schluessel] = fingerabdruck; fromCode += schluessel }
        override fun fromCode(schluessel: String) = schluessel in fromCode
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
    private fun system(vararg roots: String): X509ExtendedTrustManager {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        roots.forEachIndexed { i, w -> ks.setCertificateEntry("w$i", zert(w)) }
        return TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(ks) }.trustManagers.filterIsInstance<X509ExtendedTrustManager>().first()
    }

    private fun eigener() = "${server.url("/").host}:${server.port}"

    private fun fetch(
        kette: X509ExtendedTrustManager,
        own: String = eigener(),
        fremd: X509ExtendedTrustManager = kette,
        families: Map<String, String> = PROBE_FAMILY,
        ct: Boolean = false,
    ): Boolean {
        val tm = PinTrust(kette, pins, ownServer = { own }, frage = frage, foreignHosts = fremd, families = families,
            ctForced = ct)
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
        assertFalse(fetch(system(ROOT)))
        assertEquals("Keine Anfrage darf den Server erreichen", 0, server.requestCount)
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.ERSTKONTAKT, f.art)
        assertEquals("Angeboten wird die Wurzel, der das System vertraut", spkiFingerprint(zert(ROOT)), f.fingerabdruck)
        assertEquals(eigener(), f.schluessel)

        frage.confirm(pins, abgeschrieben())
        assertNull(frage.offen.value)
        assertTrue("Nach der Bestätigung gilt der Pin", fetch(system(ROOT)))
    }

    /** Die letzten 24 Hex-Zeichen, wie sie jemand aus der Webapp abschreibt. */
    private fun abgeschrieben() = fingerprintReadable(frage.offen.value!!.fingerabdruck).takeLast(35)

    @Test
    fun `nach der Bestaetigung gilt der Pin auch ohne bekannte CA`() {
        starte()
        assertFalse(fetch(system(FOREIGN)))
        assertEquals(CertificateUnresolved.Art.UNBEKANNTE_CA, frage.offen.value?.art)
        assertTrue(frage.confirm(pins, abgeschrieben()))
        assertTrue(fetch(system(FOREIGN)))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `ein anderer Schluessel unter dem gemerkten Pin wird nicht still angenommen`() {
        starte()
        pins.rememberPin(eigener(), spkiFingerprint(zert(FOREIGN)))
        assertFalse(fetch(system(ROOT)))
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.GEAENDERT, f.art)
        assertEquals(spkiFingerprint(zert(FOREIGN)), f.erwartet)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `der Pin einer Zwischenstelle aus dem QR-Code deckt das Blatt ohne bekannte CA`() {
        starte()
        pins.rememberPin(eigener(), spkiFingerprint(zert(INTER)))
        assertTrue(fetch(system(FOREIGN)))
        assertNull(frage.offen.value)
    }

    /**
     * Caddy mit `sign_with_root`: Die Kette ist Blatt + Wurzel, und der QR-Code
     * trägt den Fingerabdruck der WURZEL. Sie genügt als Pin.
     * Gegenprobe: in fitsToPin nur das Blatt prüfen
     * (`indexOfFirst { … }` → `if (spkiFingerprint(chain[0]) == pin) 0 else -1`) → rot.
     */
    @Test
    fun `die Wurzel aus dem QR-Code genuegt als Pin, wenn die Kette Blatt und Wurzel ist`() {
        starte(ROOT_SHEET_KEY, listOf(ROOT_SHEET, WURZEL))
        pins.rememberPin(eigener(), spkiFingerprint(zert(WURZEL)))
        assertTrue(fetch(system(FOREIGN)))
        assertNull(frage.offen.value)
        assertFalse(fitsToPin(arrayOf(zert(FOREIGN), zert(WURZEL)), spkiFingerprint(zert(WURZEL))))
    }

    /**
     * Caddy erneuert sein Blatt alle paar Stunden mit neuem Schlüssel. Wer von Hand
     * einrichtet und beim ersten Kontakt bestätigt, darf danach keine Warnung
     * „Zertifikat geändert“ sehen, solange die Wurzel dieselbe ist.
     */
    @Test
    fun `ein erneuertes Blatt unter der bestaetigten Wurzel gilt ohne neue Frage`() {
        starte(RENEWED_BLATT1_KEY, listOf(RENEWED_BLATT1, RENEWED_ROOT))
        assertFalse(fetch(system(FOREIGN)))
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.UNBEKANNTE_CA, f.art)
        assertEquals(spkiFingerprint(zert(RENEWED_ROOT)), f.fingerabdruck)
        assertTrue(frage.confirm(pins, abgeschrieben()))
        assertTrue(fetch(system(FOREIGN)))

        // Derselbe Server nach der Erneuerung; ein neuer Testserver braucht einen
        // neuen Port, der bestätigte Pin zieht mit.
        val pin = pins.pin(eigener())!!
        server.shutdown()
        server = MockWebServer()
        starte(RENEWED_BLATT2_KEY, listOf(RENEWED_BLATT2, RENEWED_ROOT))
        pins.rememberPin(eigener(), pin)
        assertTrue("Das neue Blatt unter derselben Wurzel gilt", fetch(system(FOREIGN)))
        assertNull("Keine Warnung nach einer gewöhnlichen Erneuerung", frage.offen.value)
    }

    /**
     * Let's Encrypt sendet Blatt und Zwischenstelle, die Wurzel kennt das System.
     * Gepinnt wird die Wurzel: Wechselt die CA die Zwischenstelle, fragt die App
     * nicht neu — sonst lernte man, „Zertifikat geändert“ wegzutippen.
     */
    @Test
    fun `eine oeffentliche CA bietet ihre Wurzel an, eine neue Zwischenstelle fragt nicht neu`() {
        starte(OEFF_SHEET_A_KEY, listOf(OEFF_SHEET_A, OEFF_ZW_A))
        assertFalse(fetch(system(OEFF_ROOT)))
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.ERSTKONTAKT, f.art)
        assertEquals(OEFF_ROOT_HEX, fingerprintReadable(f.fingerabdruck))
        assertTrue(frage.confirm(pins, abgeschrieben()))
        assertTrue(fetch(system(OEFF_ROOT)))

        val pin = pins.pin(eigener())!!
        server.shutdown()
        server = MockWebServer()
        starte(OEFF_SHEET_B_KEY, listOf(OEFF_SHEET_B, OEFF_ZW_B))
        pins.rememberPin(eigener(), pin)
        assertTrue("Neue Zwischenstelle unter derselben Wurzel", fetch(system(OEFF_ROOT)))
        assertNull(frage.offen.value)
        assertFalse("Ohne das System gilt der Wurzel-Pin nicht", fetch(system(FOREIGN)))
    }

    @Test
    fun `ein geaenderter Schluessel gilt erst mit abgeschriebenem Fingerabdruck`() {
        starte()
        pins.rememberPin(eigener(), spkiFingerprint(zert(FOREIGN)))
        assertFalse(fetch(system(ROOT)))
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.GEAENDERT, f.art)
        val hex = fingerprintReadable(f.fingerabdruck)

        assertFalse("Ein Tipp genügt nicht", frage.confirm(pins))
        assertFalse("Vier Zeichen genügen nicht", frage.confirm(pins, hex.takeLast(5)))
        assertFalse("16 Zeichen (64 Bit) genügen nicht", frage.confirm(pins, hex.takeLast(23)))
        assertFalse("23 Zeichen genügen nicht", frage.confirm(pins, hex.replace(":", "").takeLast(23)))
        assertFalse("Falsche Zeichen", frage.confirm(pins, "00:11:22:33:44:55:66:77"))
        assertEquals("Der alte Pin bleibt", spkiFingerprint(zert(FOREIGN)), pins.pin(eigener()))
        assertEquals("Die Frage bleibt offen", f, frage.offen.value)

        assertTrue(frage.confirm(pins, hex.takeLast(35).lowercase()))
        assertNull(frage.offen.value)
        assertTrue(fetch(system(ROOT)))
    }

    @Test
    fun `ohne bekannte CA genuegt ein Tipp nicht, der Fingerabdruck wird abgeschrieben`() {
        starte()
        assertFalse(fetch(system(FOREIGN)))
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.UNBEKANNTE_CA, f.art)

        assertFalse("Ein Tipp genügt nicht", frage.confirm(pins))
        assertFalse("Falsche Zeichen", frage.confirm(pins, "00:11:22:33:44:55:66:77"))
        assertNull("Nichts gemerkt", pins.pin(eigener()))
        assertFalse("Ohne Pin geht nichts hinaus", fetch(system(FOREIGN)))
        assertEquals(0, server.requestCount)

        assertTrue(frage.confirm(pins, abgeschrieben()))
        assertTrue(fetch(system(FOREIGN)))
    }

    @Test
    fun `beim Erstkontakt mit CT-Pflicht genuegt der Vergleich`() {
        starte()
        assertFalse(fetch(system(ROOT), ct = true))
        assertEquals(CertificateUnresolved.Art.ERSTKONTAKT, frage.offen.value?.art)
        assertFalse(frage.offen.value!!.transcriptNeeded)
        assertTrue("Die Kette hat das System samt CT geprüft", frage.confirm(pins))
    }

    /** Android 11–15: Ohne CT ginge eine fehlausgestellte Kette irgendeiner öffentlichen CA mit einem Tipp durch. */
    @Test
    fun `ohne CT-Pflicht genuegt beim Erstkontakt kein Tipp, der Fingerabdruck wird abgeschrieben`() {
        starte()
        assertFalse(fetch(system(ROOT)))
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.ERSTKONTAKT, f.art)
        assertTrue(f.transcriptNeeded)
        assertFalse("Ein Tipp genügt nicht", frage.confirm(pins))
        assertFalse("Falsch abgetippt", frage.confirm(pins, "00:11:22:33:44:55:66:77:88:99:AA:BB"))
        assertNull("Nichts gemerkt", pins.pin(eigener()))
        assertFalse(fetch(system(ROOT)))
        assertEquals(0, server.requestCount)
        assertTrue(frage.confirm(pins, abgeschrieben()))
        assertTrue(fetch(system(ROOT)))
    }

    /** Den Vergleichswert hat openssl gerechnet, unabhängig von der App. */
    @Test
    fun `der Fingerabdruck steht da wie in der Webapp`() {
        assertEquals(RENEWED_ROOT_HEX, fingerprintReadable(spkiFingerprint(zert(RENEWED_ROOT))))
    }

    @Test
    fun `ein fremdes Blatt mit angehaengter echter Zwischenstelle passt nicht`() {
        val pin = spkiFingerprint(zert(INTER))
        assertTrue(fitsToPin(arrayOf(zert(LEAF), zert(INTER)), pin))
        assertFalse(fitsToPin(arrayOf(zert(FOREIGN), zert(INTER)), pin))
        assertFalse(fitsToPin(arrayOf(zert(LEAF), zert(INTER)), spkiFingerprint(zert(FOREIGN))))
    }

    @Test
    fun `fremde Hosts prueft nur die Kette`() {
        starte()
        assertTrue(fetch(system(ROOT), own = "brick.example.org:443"))
        assertNull(frage.offen.value)
        assertFalse(fetch(system(FOREIGN), own = "brick.example.org:443"))
        assertNull("Für fremde Hosts gibt es nichts zu bestätigen", frage.offen.value)
    }

    /** Nutzer-CA ist hier ROOT, das System kennt nur FOREIGN. */
    @Test
    fun `Nutzer-CAs gelten nur fuer den eigenen Server, nie fuer fremde Hosts`() {
        starte()
        val withUserCa = ChoiceTrust(system = system(FOREIGN), withUser = lazy { system(ROOT) }, userAllowed = { true })
        assertFalse("Ein fremder Host nimmt eine Nutzer-CA an",
            fetch(withUserCa, own = "brick.example.org:443", fremd = system(FOREIGN)))
        assertEquals(0, server.requestCount)
        assertNull(frage.offen.value)

        assertFalse("Auch mit Nutzer-CA geht ohne Pin nichts hinaus", fetch(withUserCa, fremd = system(FOREIGN)))
        assertEquals("Für den eigenen Server zählt die Nutzer-CA", CertificateUnresolved.Art.NUTZER_CA, frage.offen.value?.art)
    }

    /** Nutzer-CA ist ROOT: Wer sie einschleust, soll nicht mit einem Tipp durchkommen. */
    @Test
    fun `ueber eine Nutzer-CA genuegt beim ersten Kontakt kein Tipp`() {
        starte()
        val withUserCa = ChoiceTrust(system = system(FOREIGN), withUser = lazy { system(ROOT) }, userAllowed = { true })
        assertFalse(fetch(withUserCa, fremd = system(FOREIGN)))
        assertEquals(spkiFingerprint(zert(ROOT)), frage.offen.value!!.fingerabdruck)
        assertFalse("Ein Tipp genügt nicht", frage.confirm(pins))
        assertNull(pins.pin(eigener()))
        assertTrue(frage.confirm(pins, abgeschrieben()))
        assertTrue("Danach gilt die gepinnte Nutzer-CA", fetch(withUserCa, fremd = system(FOREIGN)))
    }

    /**
     * Ohne CT-Pflicht (Android 11–15) wäre „irgendeine öffentlich gültige Kette“ kein
     * Pinning: Eine fehlausgestellte Kette einer anderen CA ginge durch. Der Pin auf eine
     * System-Wurzel verlangt darum diese Wurzel; eine andere fragt wie ein neuer Schlüssel,
     * mit Abtippen. Ein Pin auf eine eigene CA deckt ohnehin keine öffentliche Kette.
     */
    @Test
    fun `ein oeffentlicher Pin haelt eine Kette unter fremder Wurzel an, auch wenn das System sie annimmt`() {
        starte(OEFF_SHEET_A_KEY, listOf(OEFF_SHEET_A, OEFF_ZW_A))
        assertFalse(fetch(system(OEFF_ROOT, OEFF2_ROOT)))
        assertEquals(CertificateUnresolved.Art.ERSTKONTAKT, frage.offen.value?.art)
        assertTrue(frage.confirm(pins, abgeschrieben()))

        val pin = pins.pin(eigener())!!
        server.shutdown()
        server = MockWebServer()
        starte(OEFF2_SHEET_KEY, listOf(OEFF2_SHEET))
        pins.rememberPin(eigener(), pin)
        assertFalse("Eine andere öffentliche Wurzel geht nicht still durch", fetch(system(OEFF_ROOT, OEFF2_ROOT)))
        assertEquals(0, server.requestCount)
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.GEAENDERT, f.art)
        assertEquals(pin, f.erwartet)
        assertEquals(spkiFingerprint(zert(OEFF2_ROOT)), f.fingerabdruck)
        assertFalse("Ein Tipp genügt nicht", frage.confirm(pins))
        assertTrue("Abgetippt gilt die neue Wurzel", frage.confirm(pins, abgeschrieben()))
        assertTrue(fetch(system(OEFF_ROOT, OEFF2_ROOT)))
        assertFalse("Ohne System-Gültigkeit kein Durchlass", fetch(system(OEFF_ROOT)))

        frage.verwerfen()
        pins.rememberPin(eigener(), spkiFingerprint(zert(RENEWED_ROOT)))
        assertFalse("Eine eigene CA bleibt an ihren Schlüssel gebunden", fetch(system(OEFF_ROOT, OEFF2_ROOT)))
        assertEquals(CertificateUnresolved.Art.GEAENDERT, frage.offen.value?.art)
        assertEquals("Nur die eine bestätigte Anfrage kam an", 1, server.requestCount)
    }

    /**
     * Let's Encrypt wechselt Zwischenstellen (R10, R11, E5, E6 …) und Wurzeln derselben
     * Familie (ISRG Root X1 → X2). Beides darf nicht nach einem neuen Fingerabdruck fragen,
     * sonst lernt man, die Warnung wegzutippen. Erkannt wird die Familie an einer festen
     * Liste (CA_FAMILIES, hier PROBE_FAMILY); ohne CT gilt sie nur, wenn das System beide kennt.
     */
    @Test
    fun `eine neue Wurzel desselben Betreibers gilt ohne neue Frage`() {
        starte(FAM_BLATT1_KEY, listOf(FAM_BLATT1, FAM_ZW1))
        val beide = system(FAM_X1, FAM_X2, OEFF_ROOT)
        assertFalse(fetch(beide))
        assertEquals(spkiFingerprint(zert(FAM_X1)), frage.offen.value!!.fingerabdruck)
        assertTrue(frage.confirm(pins, abgeschrieben()))
        assertTrue(fetch(beide))

        val pin = pins.pin(eigener())!!
        server.shutdown()
        server = MockWebServer()
        starte(FAM_BLATT2_KEY, listOf(FAM_BLATT2, FAM_ZW2))
        pins.rememberPin(eigener(), pin)
        assertTrue("Neue Wurzel und Zwischenstelle desselben Betreibers", fetch(beide))
        assertNull("Keine Warnung beim Wechsel innerhalb der Familie", frage.offen.value)
        assertEquals("Der Pin bleibt, wie er bestätigt wurde", pin, pins.pin(eigener()))

        pins.holdBefore(eigener(), pin)
        assertFalse("Ein Code verlangt genau seine Wurzel", fetch(beide))
        assertEquals(CertificateUnresolved.Art.CODE_ABWEICHUNG, frage.offen.value?.art)
    }

    /**
     * Ein Pin auf eine System-Wurzel heisst „öffentlich gültig“, und dazu gehört die
     * CT-Prüfung des Systems. Schickt der Server die Wurzel mit, darf der Abgleich mit
     * dem Pin diese Prüfung nicht ersetzen. Das „System“ hier kennt die Wurzel, lehnt
     * aber jede Kette ab, wie es eine nicht protokollierte Ausstellung täte.
     */
    @Test
    fun `ein Pin auf eine System-Wurzel gilt nur mit der System-Pruefung, auch wenn der Server sie mitschickt`() {
        starte(ROOT_SHEET_KEY, listOf(ROOT_SHEET, WURZEL))
        val basis = system(WURZEL)
        val withoutCt = object : X509ExtendedTrustManager() {
            private fun nein(): Nothing = throw CertificateException("nicht in den CT-Protokollen")
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, s: Socket?) { nein() }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) { nein() }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String) { nein() }
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, s: Socket?) = basis.checkClientTrusted(c, a, s)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) = basis.checkClientTrusted(c, a, e)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String) = basis.checkClientTrusted(c, a)
            override fun getAcceptedIssuers(): Array<X509Certificate> = basis.acceptedIssuers
        }
        pins.rememberPin(eigener(), spkiFingerprint(zert(WURZEL)))
        assertFalse("Die mitgeschickte Wurzel ersetzt die System-Prüfung", fetch(basis, fremd = withoutCt))
        assertEquals(0, server.requestCount)
        assertEquals(CertificateUnresolved.Art.GEAENDERT, frage.offen.value?.art)

        frage.verwerfen()
        assertTrue("Mit bestandener System-Prüfung gilt der Pin", fetch(basis, fremd = basis))
        assertNull(frage.offen.value)
    }

    /**
     * Der Code nennt eine System-Wurzel, der Server zeigt eine Kette unter einer anderen,
     * ebenfalls öffentlichen. Gemerkt gälte das (Wurzelwechsel); aus dem Code nicht.
     */
    @Test
    fun `ein Code mit System-Wurzel muss genau diese Wurzel treffen, eine Abweichung bricht ab`() {
        starte(OEFF_SHEET_A_KEY, listOf(OEFF_SHEET_A, OEFF_ZW_A))
        val beide = system(OEFF_ROOT, OEFF2_ROOT)
        pins.holdBefore(eigener(), spkiFingerprint(zert(OEFF2_ROOT)))
        assertFalse("Eine andere öffentliche Wurzel als im Code", fetch(beide))
        assertEquals(0, server.requestCount)
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.CODE_ABWEICHUNG, f.art)
        assertEquals(spkiFingerprint(zert(OEFF2_ROOT)), f.erwartet)
        assertEquals(spkiFingerprint(zert(OEFF_ROOT)), f.fingerabdruck)
        assertFalse("Ein Tipp bestätigt keine Abweichung vom Code", frage.confirm(pins))
        assertFalse("Auch abgetippt nicht", frage.confirm(pins, abgeschrieben()))
        assertEquals("Der Code-Pin bleibt, nichts Neues gemerkt", spkiFingerprint(zert(OEFF2_ROOT)), pins.pin(eigener()))

        frage.verwerfen()
        pins.holdBefore(eigener(), spkiFingerprint(zert(OEFF_ROOT)))
        assertTrue("Die Wurzel aus dem Code trägt die Kette", fetch(beide))
        assertNull(frage.offen.value)
    }

    /** Der Code nennt die eigene CA, der Server zeigt eine öffentlich gültige Kette. */
    @Test
    fun `ein Code mit eigener CA bricht bei einer fremden oeffentlichen Kette ab statt nachzufragen`() {
        starte()
        pins.holdBefore(eigener(), spkiFingerprint(zert(FOREIGN)))
        assertFalse(fetch(system(ROOT)))
        assertEquals(0, server.requestCount)
        assertEquals(CertificateUnresolved.Art.CODE_ABWEICHUNG, frage.offen.value?.art)
        assertFalse(frage.confirm(pins, abgeschrieben()))

        frage.verwerfen()
        pins.rememberPin(eigener(), spkiFingerprint(zert(FOREIGN)))
        assertFalse(fetch(system(ROOT)))
        assertEquals("Ein gemerkter Pin fragt weiter nach", CertificateUnresolved.Art.GEAENDERT, frage.offen.value?.art)
    }

    /** Die Fassung ohne Socket kennt den Host nicht; ein Pin des eigenen Servers gilt trotzdem. */
    @Test
    fun `ohne Host faellt ein gepinnter Server nicht auf die System-CAs zurueck`() {
        val tm = PinTrust(system(FOREIGN), pins, ownServer = { "nas:8443" }, frage = frage, foreignHosts = system(FOREIGN))
        tm.checkServerTrusted(arrayOf(zert(FOREIGN)), "ECDHE_ECDSA")
        pins.rememberPin("nas:8443", spkiFingerprint(zert(INTER)))
        val abgelehnt = runCatching { tm.checkServerTrusted(arrayOf(zert(FOREIGN)), "ECDHE_ECDSA") }.isFailure
        assertTrue("Eine System-CA ersetzt den Pin nicht", abgelehnt)
        tm.checkServerTrusted(arrayOf(zert(LEAF), zert(INTER)), "ECDHE_ECDSA")
    }

    /** Ohne Host dieselbe Regel für einen öffentlichen Pin: seine Wurzel oder eine desselben Betreibers. */
    @Test
    fun `ohne Host gilt ein oeffentlicher Pin nur fuer seine Wurzel und deren Familie`() {
        val sys = system(OEFF_ROOT, OEFF2_ROOT, FAM_X1, FAM_X2)
        val tm = PinTrust(sys, pins, ownServer = { "nas:8443" }, frage = frage, foreignHosts = sys, families = PROBE_FAMILY)
        pins.rememberPin("nas:8443", spkiFingerprint(zert(OEFF_ROOT)))
        tm.checkServerTrusted(arrayOf(zert(OEFF_SHEET_A), zert(OEFF_ZW_A)), "ECDHE_ECDSA")
        val fremd = runCatching { tm.checkServerTrusted(arrayOf(zert(OEFF2_SHEET)), "ECDHE_ECDSA") }.isFailure
        assertTrue("Eine andere öffentliche Wurzel ersetzt den Pin nicht", fremd)

        pins.rememberPin("nas:8443", spkiFingerprint(zert(FAM_X1)))
        tm.checkServerTrusted(arrayOf(zert(FAM_BLATT2), zert(FAM_ZW2)), "ECDHE_ECDSA")
    }

    /** Die Fassung mit Socket, aber ohne Handshake-Sitzung: dieselbe Regel wie ohne Socket. */
    @Test
    fun `ohne Handshake-Sitzung gilt der Pin des eigenen Servers`() {
        val tm = PinTrust(system(FOREIGN), pins, ownServer = { "nas:8443" }, frage = frage, foreignHosts = system(FOREIGN))
        tm.checkServerTrusted(arrayOf(zert(FOREIGN)), "ECDHE_ECDSA", null as Socket?)
        pins.rememberPin("nas:8443", spkiFingerprint(zert(INTER)))
        val abgelehnt = runCatching {
            tm.checkServerTrusted(arrayOf(zert(FOREIGN)), "ECDHE_ECDSA", null as Socket?)
        }.isFailure
        assertTrue("Eine System-CA ersetzt den Pin nicht", abgelehnt)
        tm.checkServerTrusted(arrayOf(zert(LEAF), zert(INTER)), "ECDHE_ECDSA", null as Socket?)
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
            private fun darf() { if (!erlaubt) throw CertificateException("entzogen") }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, s: Socket?) {
                darf(); basis.checkServerTrusted(c, a, s)
            }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) {
                darf(); basis.checkServerTrusted(c, a, e)
            }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String) { darf(); basis.checkServerTrusted(c, a) }
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, s: Socket?) = basis.checkClientTrusted(c, a, s)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) = basis.checkClientTrusted(c, a, e)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String) = basis.checkClientTrusted(c, a)
            override fun getAcceptedIssuers(): Array<X509Certificate> = basis.acceptedIssuers
        }
        val factory = RenewableTlsFactory {
            SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }.socketFactory
        }
        val c = OkHttpClient.Builder().sslSocketFactory(factory, tm)
            .connectTimeout(2, TimeUnit.SECONDS).readTimeout(2, TimeUnit.SECONDS).build()
        fun fetch() = try {
            c.newCall(Request.Builder().url(server.url("/api/v1/sets")).build()).execute().use { it.isSuccessful }
        } catch (_: IOException) { false }
        assertTrue(fetch())
        c.connectionPool.evictAll()
        erlaubt = false
        factory.renew()
        assertFalse("Die alte Sitzung wurde ohne Prüfung wieder aufgenommen", fetch())
    }

    /** Der Dialog zeigt vor dem Abtippen nur den Anfang; das Abzutippende steht nicht da. */
    @Test
    fun `der gezeigte Anfang verraet nichts vom abzutippenden Teil`() {
        val fp = spkiFingerprint(zert(RENEWED_ROOT))
        val anfang = fingerprintStart(fp)
        assertTrue(anfang, anfang.startsWith("8E:04:B3:9F"))
        val gezeigt = anfang.uppercase().filter { it in "0123456789ABCDEF" }
        assertEquals(8, gezeigt.length)
        assertFalse(RENEWED_ROOT_HEX.replace(":", "").takeLast(24).contains(gezeigt))
        assertFalse("Der Anfang allein bestätigt nichts", Transcript.confirmed(anfang, fp))
    }

    /**
     * Die Webapp zeigt `AB:CD:…`; wer 24 sichtbare Zeichen samt Doppelpunkten abschrieb,
     * hatte nur 16 Hex und bekam „passt nicht“. Jetzt heisst das „zu kurz“.
     */
    @Test
    fun `eine Abschrift mit Doppelpunkten ist zu kurz, nicht falsch`() {
        val fp = spkiFingerprint(zert(RENEWED_ROOT))
        val sichtbar24 = RENEWED_ROOT_HEX.takeLast(24)
        assertEquals(Transcript.TO_SHORT, Transcript.von(sichtbar24, fp))
        assertEquals(Transcript.PASST, Transcript.von(RENEWED_ROOT_HEX.takeLast(35), fp))
        assertEquals(Transcript.PASST, Transcript.von(RENEWED_ROOT_HEX.replace(":", "").takeLast(24).lowercase(), fp))
        assertEquals(Transcript.PASST, Transcript.von(fp, fp))
        assertEquals(Transcript.FITS_NOT, Transcript.von("0".repeat(24), fp))
        assertEquals(Transcript.FITS_NOT, Transcript.von("XY".repeat(12), fp))
        assertEquals(Transcript.LEER, Transcript.von(" : ", fp))
    }

    @Test
    fun `der Pin gilt je Host und Port, nur fuer https`() {
        assertEquals("brick.example.org:443", pinKey("https://Brick.Example.org/"))
        assertEquals("nas:8443", pinKey("https://nas:8443/brick"))
        assertNull(pinKey("http://nas:3000"))
    }

    @Test
    fun `ein QR-Code traegt den Fingerabdruck mit`() {
        val fp = spkiFingerprint(zert(LEAF))
        val p = parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc","fp":"$fp"}""")!!
        assertEquals(fp, p.fingerabdruck)
        assertNull(parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc"}""")!!.fingerabdruck)
    }

    @Test
    fun `ein QR-Code mit unlesbarem Fingerabdruck gilt nicht`() {
        assertNull(parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc","fp":"kurz"}"""))
        val fp = spkiFingerprint(zert(LEAF))
        assertNull("Ein Pin über http ergibt nichts", parseQrPayload("""{"url":"http://nas:3000","token":"bim:abc","fp":"$fp"}"""))
        assertNull(parseQrPayload("""{"url":"https://nas","token":"fremd"}"""))
    }

    /**
     * Nach einer Erneuerung mit neuem Schlüssel unter derselben öffentlichen Wurzel. Pins ziehen
     * mit auf den neuen Port des Testservers, wie bei einem Neustart desselben Servers.
     */
    private fun newServer(sheetKey: String, kette: List<String>) {
        val alt = eigener()
        server.shutdown()
        server = MockWebServer()
        starte(sheetKey, kette)
        pins.map.filterKeys { it.startsWith(alt) }.forEach { (k, v) -> pins.map[k.replaceFirst(alt, eigener())] = v }
    }

    @Test
    fun `ein neuer Serverschluessel unter derselben oeffentlichen Wurzel fragt bewusst nach`() {
        starte(OEFF_SHEET_A_KEY, listOf(OEFF_SHEET_A, OEFF_ZW_A))
        assertFalse(fetch(system(OEFF_ROOT)))
        assertTrue(frage.confirm(pins, abgeschrieben()))
        assertEquals("Mit dem Ja zur Wurzel ist auch das Blatt gemerkt",
            spkiFingerprint(zert(OEFF_SHEET_A)), pins.pin(sheetPinKey(eigener())))
        assertTrue(fetch(system(OEFF_ROOT)))

        newServer(OEFF_SHEET_B_KEY, listOf(OEFF_SHEET_B, OEFF_ZW_B))
        assertFalse("Ein anderer Serverschlüssel geht nicht still durch", fetch(system(OEFF_ROOT)))
        assertEquals(0, server.requestCount)
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.SCHLUESSEL_NEU, f.art)
        assertEquals(spkiFingerprint(zert(OEFF_SHEET_A)), f.erwartet)
        assertEquals(spkiFingerprint(zert(OEFF_SHEET_B)), f.fingerabdruck)
        assertEquals("Der Wurzel-Pin bleibt", spkiFingerprint(zert(OEFF_ROOT)), pins.pin(eigener()))
        assertTrue(f.transcriptNeeded)
        assertFalse("Ohne CT-Pflicht genügt ein Tipp nicht", frage.confirm(pins))
        assertFalse("Falsch abgetippt", frage.confirm(pins, "00:11:22:33:44:55:66:77:88:99:AA:BB"))
        assertEquals(spkiFingerprint(zert(OEFF_SHEET_A)), pins.pin(sheetPinKey(eigener())))
        assertTrue("Abgetippt gilt der neue Schlüssel", frage.confirm(pins, abgeschrieben()))
        assertEquals(spkiFingerprint(zert(OEFF_SHEET_B)), pins.pin(sheetPinKey(eigener())))
        assertTrue(fetch(system(OEFF_ROOT)))
    }

    @Test
    fun `mit CT-Pflicht genuegt fuer einen neuen Serverschluessel ein Tipp`() {
        starte(OEFF_SHEET_B_KEY, listOf(OEFF_SHEET_B, OEFF_ZW_B))
        pins.rememberPin(eigener(), spkiFingerprint(zert(OEFF_ROOT)))
        pins.rememberPin(sheetPinKey(eigener()), spkiFingerprint(zert(OEFF_SHEET_A)))
        assertFalse(fetch(system(OEFF_ROOT), ct = true))
        val f = frage.offen.value!!
        assertEquals(CertificateUnresolved.Art.SCHLUESSEL_NEU, f.art)
        assertFalse("Das System hat CT geprüft", f.transcriptNeeded)
        assertTrue(frage.confirm(pins))
        assertTrue(fetch(system(OEFF_ROOT), ct = true))
    }

    @Test
    fun `ohne gemerkten Serverschluessel wird er beim ersten Durchlauf festgehalten`() {
        starte(OEFF_SHEET_A_KEY, listOf(OEFF_SHEET_A, OEFF_ZW_A))
        pins.rememberPin(eigener(), spkiFingerprint(zert(OEFF_ROOT)))
        assertTrue("Ältere Fassung ohne zweiten Pin: keine Frage", fetch(system(OEFF_ROOT)))
        assertNull(frage.offen.value)
        assertEquals(spkiFingerprint(zert(OEFF_SHEET_A)), pins.pin(sheetPinKey(eigener())))
    }

    @Test
    fun `ein Code vom angemeldeten Bildschirm tauscht den Serverschluessel ohne Frage`() {
        starte(OEFF_SHEET_B_KEY, listOf(OEFF_SHEET_B, OEFF_ZW_B))
        pins.rememberPin(sheetPinKey(eigener()), spkiFingerprint(zert(OEFF_SHEET_A)))
        pins.holdBefore(eigener(), spkiFingerprint(zert(OEFF_ROOT)))
        assertTrue(fetch(system(OEFF_ROOT)))
        assertNull(frage.offen.value)
        assertEquals(spkiFingerprint(zert(OEFF_SHEET_B)), pins.pin(sheetPinKey(eigener())))
    }

    @Test
    fun `der Serverschluessel bindet nur unter einer oeffentlichen Wurzel, eine eigene CA erneuert still`() {
        starte(RENEWED_BLATT1_KEY, listOf(RENEWED_BLATT1, RENEWED_ROOT))
        pins.rememberPin(eigener(), spkiFingerprint(zert(RENEWED_ROOT)))
        pins.rememberPin(sheetPinKey(eigener()), spkiFingerprint(zert(RENEWED_BLATT2)))
        assertTrue("Caddy erneuert sein internes Blatt alle paar Stunden", fetch(system(FOREIGN)))
        assertNull(frage.offen.value)
    }

    @Test
    fun `dasselbe O= im Subjekt macht noch keine Familie, nur die feste Liste`() {
        starte(FAM_BLATT1_KEY, listOf(FAM_BLATT1, FAM_ZW1))
        val beide = system(FAM_X1, FAM_X2, OEFF_ROOT)
        pins.rememberPin(eigener(), spkiFingerprint(zert(FAM_X2)))
        assertFalse("Gleiches O=, aber in keiner Familie", fetch(beide, families = emptyMap()))
        assertEquals(CertificateUnresolved.Art.GEAENDERT, frage.offen.value?.art)
        frage.verwerfen()
        assertTrue("Dieselben Wurzeln als Familie eingetragen", fetch(beide))

        assertEquals(CA_FAMILIES["C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M="], CA_FAMILIES["diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI="])
        assertFalse("ISRG und Google sind verschiedene Betreiber",
            CA_FAMILIES["C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M="] == CA_FAMILIES["hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc="])
        assertTrue(CA_FAMILIES.keys.all { Base64.getDecoder().decode(it).size == 32 })
    }

    @Test
    fun `beim Erstkontakt darf man abtippen, falsch Abgetipptes gilt nicht`() {
        starte()
        assertFalse(fetch(system(ROOT), ct = true))
        assertEquals(CertificateUnresolved.Art.ERSTKONTAKT, frage.offen.value?.art)
        assertFalse("Falsch abgetippt", frage.confirm(pins, "00:11:22:33:44:55:66:77:88:99:AA:BB"))
        assertNull(pins.pin(eigener()))
        assertTrue("Richtig abgetippt", frage.confirm(pins, abgeschrieben()))
        assertTrue(fetch(system(ROOT), ct = true))
    }

    private companion object {
        val PW = "test".toCharArray()
        fun zert(b64: String): X509Certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(Base64.getDecoder().decode(b64).inputStream()) as X509Certificate

        /** Die Probe-Wurzeln X1 und X2 als eine Familie, wie ISRG Root X1 und X2 in [CA_FAMILIES]. */
        val PROBE_FAMILY: Map<String, String> by lazy {
            mapOf(spkiFingerprint(zert(FAM_X1)) to "Probe CA", spkiFingerprint(zert(FAM_X2)) to "Probe CA")
        }

        const val ROOT = "MIIBlTCCATugAwIBAgIUCbgn7Upu9fEAMGToKKauXo+baGUwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAXMRUwEwYDVQQDDAxCcmljayBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR8FJcl3BEyvVpJgfQ/T5qw/+pweuS6179KUZKyiCZGxiBp5q11Lyk/Z/qZ3lYWC8vf5F1vn/BNqU7bbKB3HhkPo2MwYTAdBgNVHQ4EFgQUXGDtWh02N49g+YF9OEkqvnoC1EgwHwYDVR0jBBgwFoAUXGDtWh02N49g+YF9OEkqvnoC1EgwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhALnFIf/TxItrcCD4WHUT6D3XfqsMqHQ8Rx7Qjc7304s4AiADtT8yG+NtvZHTDM/cmC/eJWf/LsA1xnJTA5yXuGlxzg=="
        const val INTER = "MIIBlzCCAT2gAwIBAgIUQyjZ8Us4p6zbuUu9OD8NEe+rg0IwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAZMRcwFQYDVQQDDA5CcmljayBad2lzY2hlbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKHmNbAOfGEGwyrPGQynBjdkBGW5x/8pNc/Lcpad3cW5GqsvY5WChv5QSJhnj/3jWqC/9hIcIgoOR6w1OsgpN16jYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBS/HkuEroFohODqD2wk4HPnlSdDQDAfBgNVHSMEGDAWgBRcYO1aHTY3j2D5gX04SSq+egLUSDAKBggqhkjOPQQDAgNIADBFAiAb/nz4SUy5/d2t/ci7w0eBD9c7HadJ4CcVtCs4ugUuFwIhAJAxMmuBap9q2jYYNRmSymGdOBt78fT12KETYQ4uWnaO"
        const val LEAF = "MIIBxDCCAWqgAwIBAgIUGKFt31uRyQEpo2/dyXJUnyNBQvQwCgYIKoZIzj0EAwIwGTEXMBUGA1UEAwwOQnJpY2sgWndpc2NoZW4wIBcNMjYxMDMwMTU0MjU4WhgPMjEyNjEwMDYxNTQyNThaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMRphX3E9F+1CxrClvKYvhQLC1GyRMM0KV6hemBqhqJ4ErxTmWWsCmCaLxc9ai0HRRVGcwRaTUYN2zwUwOruxrqjgZIwgY8wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwEwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMB8GA1UdIwQYMBaAFL8eS4SugWiE4OoPbCTgc+eVJ0NAMB0GA1UdDgQWBBTYiTrV8idg50suxhBOzVR4ehDuXjAKBggqhkjOPQQDAgNIADBFAiEAqVWMQNoCR/Qv0iDKhwjlSmbIpcj4QkkvEwOLQJjmWVkCIHbT27kp+E5rJEcyBRHjRi8lrrqHGMcGJY3hZQXm0rOc"
        /** Nur für diesen Test erzeugt; schützt nichts. */
        /** Caddy sign_with_root: Blatt direkt von der Wurzel signiert (openssl). */
        const val WURZEL = "MIIBlTCCATugAwIBAgIUWfsD4SFXkS/uYDWYXA+OWZbAS0owCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAXMRUwEwYDVQQDDAxDYWRkeSBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASudcnAk+7NFzlNgXJlzLpv1WNLgSrYkYdxzHKOI9CAGktSDWCmqhJfXKbJezy/XJtJhb8No+g98CcCX+K4RZ7wo2MwYTAdBgNVHQ4EFgQULpDKa+iFWhIS/Vl4s94pdZYH43QwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgDuvgqOOE7zjj0LE3ZMADdJ6CbM9zLc9uZyPLXQIcJ24CIQDvseM//f4Ymtat2eDiE0guayf6MFBXQwVmUEAs/h5jsA=="
        const val ROOT_SHEET = "MIIBwjCCAWigAwIBAgIUJ5bQK16akXTtVJGiddkeeCeimhAwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwHo4GSMIGPMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUAZczQX6xjqiWuzi8ceAiL8aMRSgwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwCgYIKoZIzj0EAwIDSAAwRQIhAIDDuQsj3wEuClpl1bZMDbJQ1fnXG3pDWbfkcK9Nbkj1AiAoe+I71U9V5jog/wz5Y5bOc2YbEAw1q+grLMsqMP1jUA=="
        const val ROOT_SHEET_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqZs7tPJIE6CpMc2pY0PdwG3yxUHoNpKYXMHNMTymB+KhRANCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwH"
        const val LEAF_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg84oF2kTvPuV0IbWxEBoJyR56Fy+0F8JahbFGp5BLWNyhRANCAATEaYV9xPRftQsawpbymL4UCwtRskTDNCleoXpgaoaieBK8U5llrApgmi8XPWotB0UVRnMEWk1GDds8FMDq7sa6"
        /** Eine Wurzel mit zwei Blättern verschiedener Schlüssel: die Erneuerung bei Caddy. */
        const val RENEWED_ROOT = "MIIBpzCCAU2gAwIBAgIUJTOasEJOl0Pf7j0Qu01Sy8psgtYwCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVQ2FkZHkgV3VyemVsIEVybmV1ZXJ0MCAXDTI2MTEwMTA3MjY1MVoYDzIxMjYxMDA4MDcyNjUxWjAgMR4wHAYDVQQDDBVDYWRkeSBXdXJ6ZWwgRXJuZXVlcnQwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATiMyAJAa2zn6z/XzWP4N3gXVIwrNsjX3N7XNaRTwZl+kMBDrdiCWGvXlzeW4SlhxzXNuRKMVZspa9oLozWu4Ylo2MwYTAdBgNVHQ4EFgQUqmjAp54LnvWA/rxJuUqmA46NfbUwHwYDVR0jBBgwFoAUqmjAp54LnvWA/rxJuUqmA46NfbUwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhAKkqowjQxkTgYQT0X1D1/pH9AqbLfH4GRWLX/6l6x65yAiAvBcvxLwaniZ8UBE66GQyRR7OQqpBWiCvnVItju+uT7A=="
        const val RENEWED_ROOT_HEX = "8E:04:B3:9F:BF:A3:2D:A2:18:32:DB:2F:50:22:4C:2D:DE:96:AF:3A:0E:CA:01:05:95:E8:5F:1E:00:69:84:AB"
        const val RENEWED_BLATT1 = "MIIBxzCCAW6gAwIBAgIUNED1j2vQniFdnw4NBBoyn5y9NsswCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVQ2FkZHkgV3VyemVsIEVybmV1ZXJ0MCAXDTI2MTEwMTA3MjY1MVoYDzIxMjYxMDA4MDcyNjUxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARo3O3gBYVKoZ258LnBNzokFNZYa9re0sQVASwdqdtSNmwkXYr3Oin1u7J8CHuUKU5Wnj239xhxTcysx1s75gkAo4GPMIGMMAkGA1UdEwQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUvoABbHxaUxwgnYAuitc4oBTOhSYwHwYDVR0jBBgwFoAUqmjAp54LnvWA/rxJuUqmA46NfbUwCgYIKoZIzj0EAwIDRwAwRAIgJd7x9uBMAYsvqpKWq3OPtjOWKNHFEDca2A6bL+jKAigCIGwQ/YZBhOwuQgG9IZYsbsN/WOVzMgL0kInoq8EnJdFr"
        const val RENEWED_BLATT1_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQghRyFpO/jlqgF52U0y5wFGuYiEhYlqjn1ua2/I+YlOlKhRANCAARo3O3gBYVKoZ258LnBNzokFNZYa9re0sQVASwdqdtSNmwkXYr3Oin1u7J8CHuUKU5Wnj239xhxTcysx1s75gkA"
        const val RENEWED_BLATT2 = "MIIByTCCAW6gAwIBAgIUNED1j2vQniFdnw4NBBoyn5y9NswwCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVQ2FkZHkgV3VyemVsIEVybmV1ZXJ0MCAXDTI2MTEwMTA3MjY1MVoYDzIxMjYxMDA4MDcyNjUxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARW/sryEYeErhUzXKqmM/ZH8rtumVlk4/NOugkM98U5wWirXfFozbsceyOHTb6cZdwtsOb+R3MjM1T8yhe8ZBHYo4GPMIGMMAkGA1UdEwQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUrufLzJG5jvOE0ZNVIgUuFsKOjt8wHwYDVR0jBBgwFoAUqmjAp54LnvWA/rxJuUqmA46NfbUwCgYIKoZIzj0EAwIDSQAwRgIhALePJ9a9k9vdjKBxDuPGn9kIP5juXHCBuHjy49hb5EH1AiEA/qkkQkBKdBYF7ECQnwAnobnpIyIcGyfQ/MN1UO/z2dE="
        const val RENEWED_BLATT2_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSfcmm6eyJEzmbUxAk9UHevRKVQMhEqMn242fIEhY7aWhRANCAARW/sryEYeErhUzXKqmM/ZH8rtumVlk4/NOugkM98U5wWirXfFozbsceyOHTb6cZdwtsOb+R3MjM1T8yhe8ZBHY"
        /** Öffentliche CA im Kleinen: eine Wurzel, zwei Zwischenstellen mit je einem Blatt (openssl). */
        const val OEFF_ROOT = "MIIBpDCCAUmgAwIBAgIUZIFCnfxNIQRpMPTNwW7BSSFDv80wCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMYW+yzOBBNjAat0l/sP4W3ZgRVDK5kCmFCH5Dv7185TkPr5k7scjn/974EXTVvZDYU1LPsZmW3gXy0FNGysUC+jYzBhMB0GA1UdDgQWBBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNJADBGAiEAp6GVM9JkGHL6UnRaaidFdJ2KXTkT5dVarFiyfXTEfDACIQDl6sX2VT243lSNJtFFpU3znF+GxV7T8KstC/lIGpQA/g=="
        const val OEFF_ROOT_HEX = "F4:5D:D3:BE:46:44:4D:61:F1:CD:DE:03:92:B3:C5:8A:73:F3:33:DC:60:9D:AC:42:BD:C0:BB:CC:FE:19:E0:FB"
        const val OEFF_ZW_A = "MIIBoDCCAUagAwIBAgIUAQU1sXdBgqFF38Hi+ijuOG1hvwYwCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABOWdioVQKAOBRw6UiEyIXBhIl95junXb8p6oGzTDkKJWw4zE7efq82EiL0JrvnkWQziXaTCAzYqVk3xnwHqv4KSjYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBTQ5IolVueozviLke93UtJ6G3Y0EDAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAKBggqhkjOPQQDAgNIADBFAiEA/5LLzEGDA7tkDnrGKtFmUDSyWyNizCD47OaVWdjPKjsCIFH/YtymGArW/cxrFfMpLjvPzmV3bh2fen18oGROYQLj"
        const val OEFF_ZW_B = "MIIBnzCCAUagAwIBAgIUAQU1sXdBgqFF38Hi+ijuOG1hvwcwCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABDEgpbf+s6SGWZj/quaQtakWiv4xWus5vjua3ax1UXeC9LoJh5UtlfkGbQ2wXR3EFesZjh3BGkrJhJY0asO6VkijYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBQ/oP7MODYtWp9Gyzs6MtDPBmJIMDAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAKBggqhkjOPQQDAgNHADBEAiAK9OlzxqHfohUqtdRNpFUoOF4gPAqXPhPhlObB0JtBgQIgIZ0y638KPcdq6B1hVzLB3YARfLe32J/MhJExn8bcWKk="
        const val OEFF_SHEET_A = "MIIBxjCCAWygAwIBAgIUEBLGo7NHqNVaaJN74wAlRIwi4W4wCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYTAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjqRhSfxnpKW8SVpXa+tPaRt6Vlwq2CmtlrBmms1LDiwh0W5nor0jmmIAf+DK2BrKpAgzdtTPsylxmTjIGpnezqOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFOw0VRfHzwggapzdIqYWyzwb8jflMB8GA1UdIwQYMBaAFNDkiiVW56jO+IuR73dS0nobdjQQMAoGCCqGSM49BAMCA0gAMEUCIQDYuBBmG4miA9O95DWJ35JamLrl6Hiz9MlCl3EzYekrRwIgebgFsZ6Ob4etGqT4Bk/zA2N4eMcO9yAtUeQrQ04sNsU="
        const val OEFF_SHEET_A_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgHVYb+/H8EyhvizzUS3y9TAt7FlkQtQTQ67/8+ih/YaihRANCAASOpGFJ/GekpbxJWldr609pG3pWXCrYKa2WsGaazUsOLCHRbmeivSOaYgB/4MrYGsqkCDN21M+zKXGZOMgamd7O"
        const val OEFF_SHEET_B = "MIIBxjCCAWygAwIBAgIUMZo/EI4H/XOHp4BTSLv9bt1IR58wCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYjAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2E8WBySJmiIWknMzbepPni3bP68iZpP3c2WwBCqoEMZb8ppgaIFnfP4x8FfQwxmbblOfnAK9qIpIMMOKcqJLhKOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFG5BwbuRc8QPiyQocRkuaHnm7J03MB8GA1UdIwQYMBaAFD+g/sw4Ni1an0bLOzoy0M8GYkgwMAoGCCqGSM49BAMCA0gAMEUCIQCvJtbBc2pqUGlh8evmznKK1G/O8iW531jJlET2gYW5KwIgDINFCTJgae8SPreE2VipqiyzSncwBRglIT3Sw1EcC6M="
        const val OEFF_SHEET_B_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg7LsVCGLBPHR5qR7tBe+zQWeT/RemLJNrPJ7SFpGNHwyhRANCAATYTxYHJImaIhaSczNt6k+eLds/ryJmk/dzZbAEKqgQxlvymmBogWd8/jHwV9DDGZtuU5+cAr2oikgww4pyokuE"
        /** Eine zweite öffentliche Wurzel mit Blatt, für den Wurzelwechsel (openssl). */
        const val OEFF2_ROOT = "MIIBqDCCAU2gAwIBAgIUeQfiSvXaOs9VQ7JOTGuYq9+9io8wCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVT2VmZmVudGxpY2hlIFd1cnplbCAyMCAXDTI2MTEwMjA0NDcyMFoYDzIxMjYxMDA5MDQ0NzIwWjAgMR4wHAYDVQQDDBVPZWZmZW50bGljaGUgV3VyemVsIDIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARXPBIUHUcx0gndNtCFWOsc9VK1UCPYVdTt/elmdGtOr+QqU+2kj82x5bM5PwwxyeTMI0l/0m7+IhRHasjTD3wAo2MwYTAdBgNVHQ4EFgQUNiOkY9V+q2qKkLNO3YzYDvJSMtgwHwYDVR0jBBgwFoAUNiOkY9V+q2qKkLNO3YzYDvJSMtgwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSQAwRgIhAOtFyStygsxuZ82WUpQfgs4yEc9yd5SHXzEeM5gxXWiHAiEAxq1QdZDQEZLbpSZkktaMa/gUng+ruXUCb7bbSSw+VW4="
        const val OEFF2_SHEET = "MIIByjCCAXGgAwIBAgIUBZldxIW8pDuyAwDmNEUH+CvVA/8wCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVT2VmZmVudGxpY2hlIFd1cnplbCAyMCAXDTI2MTEwMjA0NDcyMFoYDzIxMjYxMDA5MDQ0NzIwWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR3UZCup1reCVwcdpUWXuBroLN2Ae2orBEjO/63RFn9ppwOTZcXNQbuX2J20HqKFM7F5pgpPdZWoCx5CuuTDLkco4GSMIGPMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQU0+JHa2fUKgS1c8Qpf2MPvkf10x0wHwYDVR0jBBgwFoAUNiOkY9V+q2qKkLNO3YzYDvJSMtgwCgYIKoZIzj0EAwIDRwAwRAIgaI3NXaJqaJPF9F3F5MA/uHYXmLEMDGlz2rerz62IXIACIGGccRCorHmF04MB3oFogbyx7s3cjhOWNIM2PivVGTsj"
        const val OEFF2_SHEET_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgkJUGxWpt9r1Mxq/Kodx7mWejKYEWCr0nz2zAkQCUrm2hRANCAAR3UZCup1reCVwcdpUWXuBroLN2Ae2orBEjO/63RFn9ppwOTZcXNQbuX2J20HqKFM7F5pgpPdZWoCx5CuuTDLkc"
        /** Eine Wurzelfamilie (O=Probe CA, X1 und X2) mit je Zwischenstelle und Blatt (openssl). */
        const val FAM_X1 = "MIIB1zCCAX2gAwIBAgIUJzODbuMp49O7i9PzkV2w30gxC1IwCgYIKoZIzj0EAwIwODELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMRYwFAYDVQQDDA1Qcm9iZSBSb290IFgxMCAXDTI2MTExMjIyNDIxNloYDzIxMjYxMDE5MjI0MjE2WjA4MQswCQYDVQQGEwJDSDERMA8GA1UECgwIUHJvYmUgQ0ExFjAUBgNVBAMMDVByb2JlIFJvb3QgWDEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARUuNHmd9ah+QgGgJ69U5FFqEDfJHZTcplKMoUTx9uqtnXkt0nNga3rKkFE8nUBs+mQxbxhs6H8hJONXLPoj/3do2MwYTAdBgNVHQ4EFgQU5H1nzHcaWbbCNal8WpErpY3lI58wHwYDVR0jBBgwFoAU5H1nzHcaWbbCNal8WpErpY3lI58wDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgHnVYf7Uk3an/+ENuf4UmjAXTNj1LVXRhn6GnI157qXoCIQDYdqvLYvqR9Uf6AynUCULrbJPWP8cnnakq5zfbO76rOw=="
        const val FAM_X2 = "MIIB2DCCAX2gAwIBAgIUZheftwIsVO/Lw4GKHC17PDM9IW4wCgYIKoZIzj0EAwIwODELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMRYwFAYDVQQDDA1Qcm9iZSBSb290IFgyMCAXDTI2MTExMjIyNDIxNloYDzIxMjYxMDE5MjI0MjE2WjA4MQswCQYDVQQGEwJDSDERMA8GA1UECgwIUHJvYmUgQ0ExFjAUBgNVBAMMDVByb2JlIFJvb3QgWDIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASVMxFZrHfC3rLaN+X+89rBSb9Y5FQM/jyQsho9YVNduoktegRSTXsgo2/c0bc3n0jcvm1LjpgA3kR7UrjuqhB1o2MwYTAdBgNVHQ4EFgQUSWxTgGmf7qCPhpF4+oTEdFfbt1AwHwYDVR0jBBgwFoAUSWxTgGmf7qCPhpF4+oTEdFfbt1AwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSQAwRgIhAO4LW747aWqnQQLBec/8WFJVoyFn0ZPFQrCj9kS9iOheAiEAykAmF3X2ienlupzTv9sg0H4idHw7+TrhBzq1ttXUkAo="
        const val FAM_ZW1 = "MIIB1TCCAXugAwIBAgIUcxqXDLMucdnJUvdXSU200z/6CpEwCgYIKoZIzj0EAwIwODELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMRYwFAYDVQQDDA1Qcm9iZSBSb290IFgxMCAXDTI2MTExMjIyNDIxNloYDzIxMjYxMDE5MjI0MjE2WjAzMQswCQYDVQQGEwJDSDERMA8GA1UECgwIUHJvYmUgQ0ExETAPBgNVBAMMCFByb2JlIFIxMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESI0Y95hHR15r9CTFyMw2fg66mx/UMLiGlBb5h5iRfEz8XkHrCfY8gH3hy5Fy+yKOj9RdQzMaYhj+Pjovl/HIwKNmMGQwEgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFCKWzIu4eTvpk2kmEcALVu++zsPCMB8GA1UdIwQYMBaAFOR9Z8x3Glm2wjWpfFqRK6WN5SOfMAoGCCqGSM49BAMCA0gAMEUCIQD5+HD2WNxENATDGHNxHydbh7TyR9JOSYMA27b3qslWrgIgVlCWtn8GGQMCDZCUcr5qG2dFquSChq0d30PJlOAEkwQ="
        const val FAM_ZW2 = "MIIB1jCCAXugAwIBAgIUTviRjd59mbAE1uyWwEBG8VdX1LUwCgYIKoZIzj0EAwIwODELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMRYwFAYDVQQDDA1Qcm9iZSBSb290IFgyMCAXDTI2MTExMjIyNDIxNloYDzIxMjYxMDE5MjI0MjE2WjAzMQswCQYDVQQGEwJDSDERMA8GA1UECgwIUHJvYmUgQ0ExETAPBgNVBAMMCFByb2JlIEUxMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE8C1AlzWJOhFrt+uXMezg2KEW01EJjKsmj7r3mfEnE4bRlm53a4s+tDHMv3XFifq0qz12oRoi0JnWmi/LjAxjJqNmMGQwEgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFKGSGBMlJLt7iP5WeAUnB5uh7xNgMB8GA1UdIwQYMBaAFElsU4Bpn+6gj4aRePqExHRX27dQMAoGCCqGSM49BAMCA0kAMEYCIQDFExiLUmuKfN8fzuDuMPkhApZ9U8kDWVWrsG0s8qQ/hwIhAKphh7yr0+RQvSf6Lm05TotgCCRhLayqaePQHxFVAa8N"
        const val FAM_BLATT1 = "MIIB2jCCAYGgAwIBAgIUT34beNuro6nHUHATsfzY+INQt1owCgYIKoZIzj0EAwIwMzELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMREwDwYDVQQDDAhQcm9iZSBSMTAgFw0yNjExMTIyMjQyMTZaGA8yMTI2MTAxOTIyNDIxNlowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEG4mfnp0oEjncOmSXTH83HhI1O5ycvivUz8ohJNHl69iSp6ROieEYhknl++4BsMNY01tV/jYJRLwl4xkcb4YwTqOBjzCBjDAJBgNVHRMEAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFDpGZaw1mk5rlgejdKfBVuNXmrcsMB8GA1UdIwQYMBaAFCKWzIu4eTvpk2kmEcALVu++zsPCMAoGCCqGSM49BAMCA0cAMEQCIFKXCXL3fz+yTXVpMtuqe1eGa0vvoDsfa1M99xkw0U+YAiAfy2Hnhd+IpZ8O7573E9OEojFqjXiW6nHx+nRTKNJbQw=="
        const val FAM_BLATT1_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgMnzKdS6G8eGJ9bCUBVAQXpo7Nw1S/dE8KgE9q/FgoA6hRANCAAQbiZ+enSgSOdw6ZJdMfzceEjU7nJy+K9TPyiEk0eXr2JKnpE6J4RiGSeX77gGww1jTW1X+NglEvCXjGRxvhjBO"
        const val FAM_BLATT2 = "MIIB2zCCAYGgAwIBAgIUXFbE1wHFPMfHZBZE/OQCukz4F3MwCgYIKoZIzj0EAwIwMzELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMREwDwYDVQQDDAhQcm9iZSBFMTAgFw0yNjExMTIyMjQyMTZaGA8yMTI2MTAxOTIyNDIxNlowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEATeMiZj5Q+Jg96WuokKkgVVY2Vl8BgGvnPO/m+FTqkObHl1hOSYcPyF0kICrdg2vS3BWr4V11KJ8+WBVdG0rx6OBjzCBjDAJBgNVHRMEAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFMtJdC/hyPnfWeAFrLSRa/s519VQMB8GA1UdIwQYMBaAFKGSGBMlJLt7iP5WeAUnB5uh7xNgMAoGCCqGSM49BAMCA0gAMEUCIQDzcg4cy2wilhPGJ+M4abqHPN2RU4janMtiuTUStwt8/gIgIiw1cNAS9LlNkHuzbpCiTcXHVFvcWM7sF176t5lq24Y="
        const val FAM_BLATT2_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgck9Ek03fOxXwdbOymEx7SBLzTYC58mv7FEPm0b73XrOhRANCAAQBN4yJmPlD4mD3pa6iQqSBVVjZWXwGAa+c87+b4VOqQ5seXWE5Jhw/IXSQgKt2Da9LcFavhXXUonz5YFV0bSvH"
        const val FOREIGN = "MIIBmDCCAT6gAwIBAgIUBpLM0+8DZR9WqDw7DqtrEKH9KDswCgYIKoZIzj0EAwIwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATSAfTFPtfDF3dy0bcjX8dCElM9oKs2NYwoZEyfWsb5EIpbYtqP7F6JCLbrsb7GVytdEqsatNJDifymfYNnIJPjo2wwajAdBgNVHQ4EFgQU5NOS8aVLD/bPQjWQ5foWE5AcTIQwHwYDVR0jBBgwFoAU5NOS8aVLD/bPQjWQ5foWE5AcTIQwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMAwGA1UdEwEB/wQCMAAwCgYIKoZIzj0EAwIDSAAwRQIgD2hCTe+02K17PzDfV7EgrTEgIV1C99ShlLSwHZsc1IICIQCknNnfSKSNOc+Kilyyna8ag4H9A8XH9kfcAia1XVWbDg=="
    }
}
