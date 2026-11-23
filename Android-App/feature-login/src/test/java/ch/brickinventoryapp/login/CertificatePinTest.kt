package ch.brickinventoryapp.login

import ch.brickinventoryapp.login.ui.parseQrPayload
import ch.brickinventoryapp.network.util.RenewableTlsFactory
import ch.brickinventoryapp.security.CA_FAMILIES
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.ChoiceTrust
import ch.brickinventoryapp.security.PinStore
import ch.brickinventoryapp.security.PinTrust
import ch.brickinventoryapp.security.Transcript
import ch.brickinventoryapp.security.fingerprintReadable
import ch.brickinventoryapp.security.fingerprintStart
import ch.brickinventoryapp.security.fitsToPin
import ch.brickinventoryapp.security.pinKey
import ch.brickinventoryapp.security.sheetPinKey
import ch.brickinventoryapp.security.spkiFingerprint
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
import java.net.Socket
import java.security.KeyFactory
import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager

/**
 * Pinning of our own server, over real TLS against a test server: root →
 * intermediate → leaf "localhost", plus a foreign self-signed leaf.
 * The certificates are fixed test data (valid for 100 years).
 *
 * Counter-checks:
 *   A  in check() without a pin `return kettenPruefung()` instead of asking → red
 *      “without a pin, nothing goes out on first contact”
 *   B  fitsToPin() only `indexOfFirst >= 0` (without a path check) → red “a
 *      foreign leaf with a real intermediate attached does not fit”
 *   C  on a deviating pin `return` instead of reporting → red “a different
 *      key under the remembered pin is not silently accepted”
 *   D  the comparison with ownServer() removed (all hosts pinned) → red
 *      “foreign hosts are checked only by the chain”
 *   E  parseQrPayload() takes an unreadable fp → red “a QR code with an
 *      unreadable fingerprint is not valid”
 *   F  in check() back to `chain[0]` instead of `chain.last()` → red
 *      “without a pin, nothing goes out on first contact …” (leaf instead of
 *      intermediate) and “a renewed leaf under the confirmed root …”
 *      (CHANGED after the renewal)
 *   G  fingerprintReadable() back to groups of four → red “the
 *      fingerprint is shown as in the web app”
 *   H  in check() foreign hosts back to `userCaTrust` instead of
 *      `foreignHosts` → red “user CAs apply only to our own server …”
 *   I  in check() back to `spkiFingerprint(chain.last())` instead of the root
 *      from the system → red “a public CA offers its root …”
 *      and “without a pin, nothing goes out on first contact …”
 *   J  in CertificateQuestion.confirm() the condition for CHANGED removed →
 *      red “a changed key only counts once typed off …”
 *   K  bestaetigtFingerabdruck() with `>= 4` instead of `>= 16` → red “a
 *      changed key …” (four typed characters were enough); likewise
 *      FINGERPRINT_TYPE_IN = 16 instead of 24 → red there (“16 characters (64 bits) …”)
 *   L  in confirm() back to checking only CHANGED (`f.kind == CHANGED &&`)
 *      → red “without a known CA, a tap is not enough …”
 *   M  the line `if (pin != null && public && pin in
 *      systemRoots) return` removed → red “a public CA …”, “a
 *      changed key …” (the state before the root pin, see X)
 *   N  there without `&& pin in systemRoots` → red “a public pin …”
 *      (“a user's own CA stays bound to its key”) and “a different
 *      key under the remembered pin …”
 *   O  `viaUserCa -> USER_CA` back to FIRST_CONTACT → red “via a
 *      user CA a tap is enough …” (“A tap is not enough”) and “user CAs apply …”
 *   P  in checkServerTrusted without a socket `if (!fitsToPin(chain, pin))` →
 *      `if (pin.isEmpty())` → red “without a host, a pinned server falls back …”
 *   Q  fingerprintStart() without `.take(11)` → red “the shown start …”
 * Counter-checks:
 *   R  in check() without a handshake session back to `with(foreignHosts)` → red “without a
 *      handshake session, our own server's pin applies”
 *   S  RenewableTlsFactory.erneuere() without effect → red “after renewing,
 *      a new connection checks the chain again” (the session was resumed)
 * Counter-check:
 *   T  in check() back to `if (pin != null && fitsToPin(chain, pin)) return` (also
 *      for a system root) → red “a pin on a system root only counts with the
 *      system check …”; counter-checks/root-pin-without-ct.patch
 * Counter-checks for the pin from the scanned code (measured locally):
 *   U  in check() back to `if (publicPin && public) return` (without
 *      `!fromCode`) → red “a code with a system root must name exactly that root …”;
 *      counter-checks/code-root-unchecked.patch
 *   V  in confirm() the line for CODE_MISMATCH removed → red “a code with a
 *      system root …” (confirmable once typed off); counter-checks/code-mismatch-confirmable.patch
 *   W  on a deviating pin always CHANGED → red “a code with its own CA …”;
 *      counter-checks/code-mismatch-as-question.patch
 * Counter-checks for the public pin (12.11.2026, kotlinc against ServerTrust.kt):
 *   X  carriesPin() back to `situation.public && (!fromCode || …)` (any public chain) →
 *      red “a public pin holds onto a chain under a foreign root …”;
 *      counter-checks/public-pin-any-root.patch
 *   Y  in carriesPin() and withoutHost() without sameOperator() → red “a new root
 *      of the same operator …” and “without a host, a public pin applies …”;
 *      counter-checks/root-family-asks-again.patch
 *   Z  withoutHost() back to `pin in systemRoots → system()` → red “without a host, a
 *      public pin applies …”; counter-checks/without-host-any-root.patch
 * Counter-checks for the transcript (12.11.2026, kotlinc):
 *   AA in Abschrift.of() too short back to FITS_NOT → red “a transcript with
 *      colons is too short …”; counter-checks/transcript-too-short-unnoticed.patch
 *   (The colons while typing are checked by core-ui, TranscriptShapeTest.)
 * Counter-checks for the second pin and the CA families (14.11.2026, kotlinc against
 * ServerTrust.kt, local JUnit):
 *   AB in check() back to `if (carriesPin(…)) return` without checkSheet() → red “a new
 *      server key under the same public root …”;
 *      counter-checks/leaf-pin-unchecked.patch
 *   AC sameOperator() back to the O= in the subject → red “the same O= in the subject
 *      does not yet make a family …”; counter-checks/family-by-subject.patch
 *   AD in confirm() typing it off on first contact not checked (`optional` even with
 *      input) → red “on first contact, typing it off is optional …”;
 *      counter-checks/first-contact-transcript-unchecked.patch
 *   AE in checkSheet() `|| fromCode` removed → red “a code from the signed-in screen
 *      swaps the server key …”; counter-checks/leaf-pin-code-asks.patch
 * Counter-checks for the new server key without a CT requirement (check 476e4a4, M1; CI):
 *   AF transcriptNeeded for KEY_NEW back to `false` → red “a new server key
 *      under the same public root …” (“without a CT requirement, a tap is not enough”);
 *      counter-checks/key-new-one-tap.patch
 *   AG checkSheet() does not pass ctForced on → red “with a CT requirement …”;
 *      counter-checks/key-new-without-ct-knowledge.patch
 * Counter-checks for first contact without a CT requirement (deep review A-S-5; kotlinc, local JUnit):
 *   AH transcriptNeeded for ERSTKONTAKT back to `false` → red “without a CT requirement, on
 *      first contact, no tap is enough …”; counter-checks/first-contact-one-tap-without-ct.patch
 *   AI check() reports first contact without ctForced → red “on first contact with
 *      a CT requirement, the comparison is enough”; counter-checks/first-contact-without-ct-knowledge.patch
 * Counter-check for the key change from Android 16 (local JUnit):
 *   AJ in confirm() the line with deviceConfirmationNeeded removed → red “with CT requirement a
 *      new server key needs the screen lock …” (“a tap alone …”)
 */
class CertificatePinTest {

    private var server = MockWebServer()
    private val question = CertificateQuestion()
    private val pins = object : PinStore {
        val map = mutableMapOf<String, String>()
        override fun pin(key: String) = map[key]
        override fun rememberPin(key: String, fingerprint: String) { map[key] = fingerprint; fromCode.remove(key) }
        /** Like DevicesStore.holdBefore: valid, but not yet confirmed. */
        val fromCode = mutableSetOf<String>()
        fun holdBefore(key: String, fingerprint: String) { map[key] = fingerprint; fromCode += key }
        override fun fromCode(key: String) = key in fromCode
    }

    @After
    fun tearDown() = server.shutdown()

    /** The server shows the leaf and the intermediate, as Caddy does. */
    private fun launch(key: String = LEAF_KEY, userCaTrust: List<String> = listOf(LEAF, INTER)) {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        val key = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(key)))
        ks.setKeyEntry("k", key, PW, userCaTrust.map { cert(it) }.toTypedArray())
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, PW) }
        server.useHttps(SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }.socketFactory, false)
        server.enqueue(MockResponse().setBody("ok"))
        server.enqueue(MockResponse().setBody("ok"))
        server.start()
    }

    /** The "system": trusts only the named roots. */
    private fun system(vararg roots: String): X509ExtendedTrustManager {
        val ks = KeyStore.getInstance("PKCS12").apply { load(null) }
        roots.forEachIndexed { i, w -> ks.setCertificateEntry("w$i", cert(w)) }
        return TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(ks) }.trustManagers.filterIsInstance<X509ExtendedTrustManager>().first()
    }

    private fun own() = "${server.url("/").host}:${server.port}"

    private fun fetch(
        userCaTrust: X509ExtendedTrustManager,
        own: String = own(),
        foreign: X509ExtendedTrustManager = userCaTrust,
        families: Map<String, String> = PROBE_FAMILY,
        ct: Boolean = false,
    ): Boolean {
        val tm = PinTrust(userCaTrust, pins, ownServer = { own }, question = question, foreignHosts = foreign, families = families,
            ctForced = ct)
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
        val c = OkHttpClient.Builder().sslSocketFactory(ctx.socketFactory, tm)
            .connectTimeout(2, TimeUnit.SECONDS).readTimeout(2, TimeUnit.SECONDS).build()
        return try {
            c.newCall(Request.Builder().url(server.url("/api/v2/sets")).build()).execute().use { it.isSuccessful }
        } catch (_: IOException) { false }
    }

    @Test
    fun `without a pin nothing goes out on first contact, it asks for the fingerprint`() {
        launch()
        assertFalse(fetch(system(ROOT)))
        assertEquals("No request may reach the server", 0, server.requestCount)
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.FIRST_CONTACT, f.kind)
        assertEquals("Offered is the root the system trusts", spkiFingerprint(cert(ROOT)), f.fingerprint)
        assertEquals(own(), f.key)

        question.confirm(pins, copied())
        assertNull(question.open.value)
        assertTrue("After the confirmation the pin applies", fetch(system(ROOT)))
    }

    /** The last 24 hex characters, the way someone types them off from the web app. */
    private fun copied() = fingerprintReadable(question.open.value!!.fingerprint).takeLast(35)

    @Test
    fun `after confirmation the pin applies even without a known CA`() {
        launch()
        assertFalse(fetch(system(FOREIGN)))
        assertEquals(CertificateUnresolved.Kind.UNKNOWN_CA, question.open.value?.kind)
        assertTrue(question.confirm(pins, copied()))
        assertTrue(fetch(system(FOREIGN)))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `a different key under the remembered pin is not silently accepted`() {
        launch()
        pins.rememberPin(own(), spkiFingerprint(cert(FOREIGN)))
        assertFalse(fetch(system(ROOT)))
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.CHANGED, f.kind)
        assertEquals(spkiFingerprint(cert(FOREIGN)), f.expected)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `the pin of an intermediate from the QR code covers the leaf without a known CA`() {
        launch()
        pins.rememberPin(own(), spkiFingerprint(cert(INTER)))
        assertTrue(fetch(system(FOREIGN)))
        assertNull(question.open.value)
    }

    /**
     * Caddy with `sign_with_root`: the chain is leaf + root, and the QR code
     * carries the ROOT's fingerprint. That is enough as a pin.
     * Counter-check: in fitsToPin check only the leaf
     * (`indexOfFirst { … }` → `if (spkiFingerprint(chain[0]) == pin) 0 else -1`) → red.
     */
    @Test
    fun `the root from the QR code suffices as pin if the chain is leaf and root`() {
        launch(ROOT_SHEET_KEY, listOf(ROOT_SHEET, CADDY_ROOT))
        pins.rememberPin(own(), spkiFingerprint(cert(CADDY_ROOT)))
        assertTrue(fetch(system(FOREIGN)))
        assertNull(question.open.value)
        assertFalse(fitsToPin(arrayOf(cert(FOREIGN), cert(CADDY_ROOT)), spkiFingerprint(cert(CADDY_ROOT))))
    }

    /**
     * Caddy renews its leaf every few hours with a new key. Anyone who sets up
     * by hand and confirms on first contact must not see a warning
     * "Zertifikat geändert" afterward, as long as the root stays the same.
     */
    @Test
    fun `a renewed leaf under the confirmed root applies without a new question`() {
        launch(RENEWED_SHEET1_KEY, listOf(RENEWED_SHEET1, RENEWED_ROOT))
        assertFalse(fetch(system(FOREIGN)))
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.UNKNOWN_CA, f.kind)
        assertEquals(spkiFingerprint(cert(RENEWED_ROOT)), f.fingerprint)
        assertTrue(question.confirm(pins, copied()))
        assertTrue(fetch(system(FOREIGN)))

        // The same server after the renewal; a new test server needs a
        // new port, the confirmed pin carries over.
        val pin = pins.pin(own())!!
        server.shutdown()
        server = MockWebServer()
        launch(RENEWED_SHEET2_KEY, listOf(RENEWED_SHEET2, RENEWED_ROOT))
        pins.rememberPin(own(), pin)
        assertTrue("The new leaf under the same root applies", fetch(system(FOREIGN)))
        assertNull("No warning after an ordinary renewal", question.open.value)
    }

    /**
     * Let's Encrypt sends the leaf and the intermediate, the system knows the root.
     * The root is what gets pinned: if the CA changes the intermediate, the app does
     * not ask again — otherwise one would learn to tap away "Zertifikat geändert".
     */
    @Test
    fun `a public CA offers its root, a new intermediate does not ask again`() {
        launch(PUB_SHEET_A_KEY, listOf(PUB_SHEET_A, PUB_ZW_A))
        assertFalse(fetch(system(PUB_ROOT)))
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.FIRST_CONTACT, f.kind)
        assertEquals(PUB_ROOT_HEX, fingerprintReadable(f.fingerprint))
        assertTrue(question.confirm(pins, copied()))
        assertTrue(fetch(system(PUB_ROOT)))

        val pin = pins.pin(own())!!
        server.shutdown()
        server = MockWebServer()
        launch(PUB_SHEET_B_KEY, listOf(PUB_SHEET_B, PUB_ZW_B))
        pins.rememberPin(own(), pin)
        assertTrue("New intermediate under the same root", fetch(system(PUB_ROOT)))
        assertNull(question.open.value)
        assertFalse("Without the system the root pin does not apply", fetch(system(FOREIGN)))
    }

    @Test
    fun `a changed key applies only with a transcribed fingerprint`() {
        launch()
        pins.rememberPin(own(), spkiFingerprint(cert(FOREIGN)))
        assertFalse(fetch(system(ROOT)))
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.CHANGED, f.kind)
        val hex = fingerprintReadable(f.fingerprint)

        assertFalse("A tap is not enough", question.confirm(pins))
        assertFalse("Four characters are not enough", question.confirm(pins, hex.takeLast(5)))
        assertFalse("16 characters (64 bits) are not enough", question.confirm(pins, hex.takeLast(23)))
        assertFalse("23 characters are not enough", question.confirm(pins, hex.replace(":", "").takeLast(23)))
        assertFalse("Wrong characters", question.confirm(pins, "00:11:22:33:44:55:66:77"))
        assertEquals("The old pin stays", spkiFingerprint(cert(FOREIGN)), pins.pin(own()))
        assertEquals("The question stays open", f, question.open.value)

        assertTrue(question.confirm(pins, hex.takeLast(35).lowercase()))
        assertNull(question.open.value)
        assertTrue(fetch(system(ROOT)))
    }

    @Test
    fun `without a known CA a tap is not enough, the fingerprint is transcribed`() {
        launch()
        assertFalse(fetch(system(FOREIGN)))
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.UNKNOWN_CA, f.kind)

        assertFalse("A tap is not enough", question.confirm(pins))
        assertFalse("Wrong characters", question.confirm(pins, "00:11:22:33:44:55:66:77"))
        assertNull("Nothing remembered", pins.pin(own()))
        assertFalse("Without a pin nothing goes out", fetch(system(FOREIGN)))
        assertEquals(0, server.requestCount)

        assertTrue(question.confirm(pins, copied()))
        assertTrue(fetch(system(FOREIGN)))
    }

    @Test
    fun `on first contact with CT requirement the comparison suffices`() {
        launch()
        assertFalse(fetch(system(ROOT), ct = true))
        assertEquals(CertificateUnresolved.Kind.FIRST_CONTACT, question.open.value?.kind)
        assertFalse(question.open.value!!.transcriptNeeded)
        assertTrue("The chain was checked by the system including CT", question.confirm(pins))
    }

    /** Android 11–15: without CT, a misissued chain from any public CA would get through with a tap. */
    @Test
    fun `without CT requirement a tap is not enough on first contact, the fingerprint is transcribed`() {
        launch()
        assertFalse(fetch(system(ROOT)))
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.FIRST_CONTACT, f.kind)
        assertTrue(f.transcriptNeeded)
        assertFalse("A tap is not enough", question.confirm(pins))
        assertFalse("Typed off wrongly", question.confirm(pins, "00:11:22:33:44:55:66:77:88:99:AA:BB"))
        assertNull("Nothing remembered", pins.pin(own()))
        assertFalse(fetch(system(ROOT)))
        assertEquals(0, server.requestCount)
        assertTrue(question.confirm(pins, copied()))
        assertTrue(fetch(system(ROOT)))
    }

    /** The comparison value was computed by openssl, independent of the app. */
    @Test
    fun `the fingerprint is shown as in the web app`() {
        assertEquals(RENEWED_ROOT_HEX, fingerprintReadable(spkiFingerprint(cert(RENEWED_ROOT))))
    }

    @Test
    fun `a foreign leaf with an appended genuine intermediate does not match`() {
        val pin = spkiFingerprint(cert(INTER))
        assertTrue(fitsToPin(arrayOf(cert(LEAF), cert(INTER)), pin))
        assertFalse(fitsToPin(arrayOf(cert(FOREIGN), cert(INTER)), pin))
        assertFalse(fitsToPin(arrayOf(cert(LEAF), cert(INTER)), spkiFingerprint(cert(FOREIGN))))
    }

    @Test
    fun `foreign hosts are checked only by the chain`() {
        launch()
        assertTrue(fetch(system(ROOT), own = "brick.example.org:443"))
        assertNull(question.open.value)
        assertFalse(fetch(system(FOREIGN), own = "brick.example.org:443"))
        assertNull("For foreign hosts there is nothing to confirm", question.open.value)
    }

    /** The user CA here is ROOT, the system only knows FOREIGN. */
    @Test
    fun `user CAs apply only to the own server, never to foreign hosts`() {
        launch()
        val withUserCa = ChoiceTrust(system = system(FOREIGN), withUser = lazy { system(ROOT) }, userAllowed = { true })
        assertFalse("A foreign host accepts a user CA",
            fetch(withUserCa, own = "brick.example.org:443", foreign = system(FOREIGN)))
        assertEquals(0, server.requestCount)
        assertNull(question.open.value)

        assertFalse("Even with a user CA nothing goes out without a pin", fetch(withUserCa, foreign = system(FOREIGN)))
        assertEquals("For the own server the user CA counts", CertificateUnresolved.Kind.USER_CA, question.open.value?.kind)
    }

    /** The user CA is ROOT: whoever smuggles it in should not get through with a tap. */
    @Test
    fun `via a user CA a tap is not enough on first contact`() {
        launch()
        val withUserCa = ChoiceTrust(system = system(FOREIGN), withUser = lazy { system(ROOT) }, userAllowed = { true })
        assertFalse(fetch(withUserCa, foreign = system(FOREIGN)))
        assertEquals(spkiFingerprint(cert(ROOT)), question.open.value!!.fingerprint)
        assertFalse("A tap is not enough", question.confirm(pins))
        assertNull(pins.pin(own()))
        assertTrue(question.confirm(pins, copied()))
        assertTrue("After that the pinned user CA applies", fetch(withUserCa, foreign = system(FOREIGN)))
    }

    /**
     * Without a CT requirement (Android 11–15), "any publicly valid chain" would not be
     * pinning: a misissued chain from a different CA would get through. The pin on a
     * system root therefore demands exactly that root; a different one asks like a new key,
     * with typing it off. A pin on a private CA covers no public chain anyway.
     */
    @Test
    fun `a public pin stops a chain under a foreign root, even if the system accepts it`() {
        launch(PUB_SHEET_A_KEY, listOf(PUB_SHEET_A, PUB_ZW_A))
        assertFalse(fetch(system(PUB_ROOT, PUB2_ROOT)))
        assertEquals(CertificateUnresolved.Kind.FIRST_CONTACT, question.open.value?.kind)
        assertTrue(question.confirm(pins, copied()))

        val pin = pins.pin(own())!!
        server.shutdown()
        server = MockWebServer()
        launch(PUB2_SHEET_KEY, listOf(PUB2_SHEET))
        pins.rememberPin(own(), pin)
        assertFalse("Another public root does not pass silently", fetch(system(PUB_ROOT, PUB2_ROOT)))
        assertEquals(0, server.requestCount)
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.CHANGED, f.kind)
        assertEquals(pin, f.expected)
        assertEquals(spkiFingerprint(cert(PUB2_ROOT)), f.fingerprint)
        assertFalse("A tap is not enough", question.confirm(pins))
        assertTrue("Typed off, the new root applies", question.confirm(pins, copied()))
        assertTrue(fetch(system(PUB_ROOT, PUB2_ROOT)))
        assertFalse("No passage without system validity", fetch(system(PUB_ROOT)))

        question.discard()
        pins.rememberPin(own(), spkiFingerprint(cert(RENEWED_ROOT)))
        assertFalse("An own CA stays bound to its key", fetch(system(PUB_ROOT, PUB2_ROOT)))
        assertEquals(CertificateUnresolved.Kind.CHANGED, question.open.value?.kind)
        assertEquals("Only the one confirmed request arrived", 1, server.requestCount)
    }

    /**
     * Let's Encrypt changes intermediates (R10, R11, E5, E6 …) and roots of the same
     * family (ISRG Root X1 → X2). Neither may ask for a new fingerprint,
     * otherwise one learns to tap away the warning. The family is recognized from a
     * fixed list (CA_FAMILIES, here PROBE_FAMILY); without CT it only applies if the system knows both.
     */
    @Test
    fun `a new root of the same operator applies without a new question`() {
        launch(FAM_SHEET1_KEY, listOf(FAM_SHEET1, FAM_ZW1))
        val both = system(FAM_X1, FAM_X2, PUB_ROOT)
        assertFalse(fetch(both))
        assertEquals(spkiFingerprint(cert(FAM_X1)), question.open.value!!.fingerprint)
        assertTrue(question.confirm(pins, copied()))
        assertTrue(fetch(both))

        val pin = pins.pin(own())!!
        server.shutdown()
        server = MockWebServer()
        launch(FAM_SHEET2_KEY, listOf(FAM_SHEET2, FAM_ZW2))
        pins.rememberPin(own(), pin)
        assertTrue("New root and intermediate of the same operator", fetch(both))
        assertNull("No warning on a switch within the family", question.open.value)
        assertEquals("The pin stays as it was confirmed", pin, pins.pin(own()))

        pins.holdBefore(own(), pin)
        assertFalse("A code demands exactly its root", fetch(both))
        assertEquals(CertificateUnresolved.Kind.CODE_MISMATCH, question.open.value?.kind)
    }

    /**
     * A pin on a system root means "publicly valid", and that includes the
     * system's CT check. If the server sends the root along, comparing it against
     * the pin must not replace that check. The "system" here knows the root but
     * rejects every chain, the way an unlogged issuance would.
     */
    @Test
    fun `a pin on a system root applies only with the system check, even if the server sends it along`() {
        launch(ROOT_SHEET_KEY, listOf(ROOT_SHEET, CADDY_ROOT))
        val basis = system(CADDY_ROOT)
        val withoutCt = object : X509ExtendedTrustManager() {
            private fun no(): Nothing = throw CertificateException("nicht in den CT-Protokollen")
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, s: Socket?) { no() }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) { no() }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String) { no() }
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, s: Socket?) = basis.checkClientTrusted(c, a, s)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) = basis.checkClientTrusted(c, a, e)
            override fun checkClientTrusted(c: Array<X509Certificate>, a: String) = basis.checkClientTrusted(c, a)
            override fun getAcceptedIssuers(): Array<X509Certificate> = basis.acceptedIssuers
        }
        pins.rememberPin(own(), spkiFingerprint(cert(CADDY_ROOT)))
        assertFalse("The root sent along replaces the system check", fetch(basis, foreign = withoutCt))
        assertEquals(0, server.requestCount)
        assertEquals(CertificateUnresolved.Kind.CHANGED, question.open.value?.kind)

        question.discard()
        assertTrue("With a passed system check the pin applies", fetch(basis, foreign = basis))
        assertNull(question.open.value)
    }

    /**
     * The code names a system root, the server shows a chain under a different,
     * also public one. Remembered, that would count (a root change); from the code it does not.
     */
    @Test
    fun `a code with a system root must hit exactly this root, a deviation aborts`() {
        launch(PUB_SHEET_A_KEY, listOf(PUB_SHEET_A, PUB_ZW_A))
        val both = system(PUB_ROOT, PUB2_ROOT)
        pins.holdBefore(own(), spkiFingerprint(cert(PUB2_ROOT)))
        assertFalse("Another public root than in the code", fetch(both))
        assertEquals(0, server.requestCount)
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.CODE_MISMATCH, f.kind)
        assertEquals(spkiFingerprint(cert(PUB2_ROOT)), f.expected)
        assertEquals(spkiFingerprint(cert(PUB_ROOT)), f.fingerprint)
        assertFalse("A tap confirms no deviation from the code", question.confirm(pins))
        assertFalse("Not typed off either", question.confirm(pins, copied()))
        assertEquals("The code pin stays, nothing new remembered", spkiFingerprint(cert(PUB2_ROOT)), pins.pin(own()))

        question.discard()
        pins.holdBefore(own(), spkiFingerprint(cert(PUB_ROOT)))
        assertTrue("The root from the code carries the chain", fetch(both))
        assertNull(question.open.value)
    }

    /** The code names a private CA, the server shows a publicly valid chain. */
    @Test
    fun `a code with its own CA aborts on a foreign public chain instead of asking`() {
        launch()
        pins.holdBefore(own(), spkiFingerprint(cert(FOREIGN)))
        assertFalse(fetch(system(ROOT)))
        assertEquals(0, server.requestCount)
        assertEquals(CertificateUnresolved.Kind.CODE_MISMATCH, question.open.value?.kind)
        assertFalse(question.confirm(pins, copied()))

        question.discard()
        pins.rememberPin(own(), spkiFingerprint(cert(FOREIGN)))
        assertFalse(fetch(system(ROOT)))
        assertEquals("A remembered pin keeps asking", CertificateUnresolved.Kind.CHANGED, question.open.value?.kind)
    }

    /** The version without a socket does not know the host; our own server's pin still applies. */
    @Test
    fun `without a host a pinned server does not fall back to the system CAs`() {
        val tm = PinTrust(system(FOREIGN), pins, ownServer = { "nas:8443" }, question = question, foreignHosts = system(FOREIGN))
        tm.checkServerTrusted(arrayOf(cert(FOREIGN)), "ECDHE_ECDSA")
        pins.rememberPin("nas:8443", spkiFingerprint(cert(INTER)))
        val declined = runCatching { tm.checkServerTrusted(arrayOf(cert(FOREIGN)), "ECDHE_ECDSA") }.isFailure
        assertTrue("A system CA does not replace the pin", declined)
        tm.checkServerTrusted(arrayOf(cert(LEAF), cert(INTER)), "ECDHE_ECDSA")
    }

    /** Without a host, the same rule for a public pin: its root or one of the same operator. */
    @Test
    fun `without a host a public pin applies only to its root and its family`() {
        val sys = system(PUB_ROOT, PUB2_ROOT, FAM_X1, FAM_X2)
        val tm = PinTrust(sys, pins, ownServer = { "nas:8443" }, question = question, foreignHosts = sys, families = PROBE_FAMILY)
        pins.rememberPin("nas:8443", spkiFingerprint(cert(PUB_ROOT)))
        tm.checkServerTrusted(arrayOf(cert(PUB_SHEET_A), cert(PUB_ZW_A)), "ECDHE_ECDSA")
        val foreign = runCatching { tm.checkServerTrusted(arrayOf(cert(PUB2_SHEET)), "ECDHE_ECDSA") }.isFailure
        assertTrue("Another public root does not replace the pin", foreign)

        pins.rememberPin("nas:8443", spkiFingerprint(cert(FAM_X1)))
        tm.checkServerTrusted(arrayOf(cert(FAM_SHEET2), cert(FAM_ZW2)), "ECDHE_ECDSA")
    }

    /** The version with a socket but without a handshake session: the same rule as without a socket. */
    @Test
    fun `without a handshake session the own server's pin applies`() {
        val tm = PinTrust(system(FOREIGN), pins, ownServer = { "nas:8443" }, question = question, foreignHosts = system(FOREIGN))
        tm.checkServerTrusted(arrayOf(cert(FOREIGN)), "ECDHE_ECDSA", null as Socket?)
        pins.rememberPin("nas:8443", spkiFingerprint(cert(INTER)))
        val declined = runCatching {
            tm.checkServerTrusted(arrayOf(cert(FOREIGN)), "ECDHE_ECDSA", null as Socket?)
        }.isFailure
        assertTrue("A system CA does not replace the pin", declined)
        tm.checkServerTrusted(arrayOf(cert(LEAF), cert(INTER)), "ECDHE_ECDSA", null as Socket?)
    }

    /**
     * A resumed TLS session checks no chain. After turning off
     * user CAs, the app rebuilds the context (ServerClient.kt); after that a new
     * connection must be checked again.
     */
    @Test
    fun `after renewal a new connection checks the chain again`() {
        launch(); server.enqueue(MockResponse().setBody("ok"))
        val basis = system(ROOT)
        var allowed = true
        val tm = object : X509ExtendedTrustManager() {
            private fun may() { if (!allowed) throw CertificateException("entzogen") }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, s: Socket?) {
                may(); basis.checkServerTrusted(c, a, s)
            }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String, e: SSLEngine?) {
                may(); basis.checkServerTrusted(c, a, e)
            }
            override fun checkServerTrusted(c: Array<X509Certificate>, a: String) { may(); basis.checkServerTrusted(c, a) }
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
            c.newCall(Request.Builder().url(server.url("/api/v2/sets")).build()).execute().use { it.isSuccessful }
        } catch (_: IOException) { false }
        assertTrue(fetch())
        c.connectionPool.evictAll()
        allowed = false
        factory.renew()
        assertFalse("The old session was resumed without a check", fetch())
    }

    /** The dialog shows only the start before typing it off; what needs to be typed off is not shown. */
    @Test
    fun `the shown beginning reveals nothing of the part to be typed`() {
        val fp = spkiFingerprint(cert(RENEWED_ROOT))
        val begin = fingerprintStart(fp)
        assertTrue(begin, begin.startsWith("8E:04:B3:9F"))
        val shown = begin.uppercase().filter { it in "0123456789ABCDEF" }
        assertEquals(8, shown.length)
        assertFalse(RENEWED_ROOT_HEX.replace(":", "").takeLast(24).contains(shown))
        assertFalse("The start alone confirms nothing", Transcript.confirmed(begin, fp))
    }

    /**
     * The web app shows `AB:CD:…`; whoever typed off 24 visible characters including colons
     * only had 16 hex and got "does not fit". Now that is called "too short".
     */
    @Test
    fun `a transcript with colons is too short, not wrong`() {
        val fp = spkiFingerprint(cert(RENEWED_ROOT))
        val visible24 = RENEWED_ROOT_HEX.takeLast(24)
        assertEquals(Transcript.TO_SHORT, Transcript.of(visible24, fp))
        assertEquals(Transcript.MATCHES, Transcript.of(RENEWED_ROOT_HEX.takeLast(35), fp))
        assertEquals(Transcript.MATCHES, Transcript.of(RENEWED_ROOT_HEX.replace(":", "").takeLast(24).lowercase(), fp))
        assertEquals(Transcript.MATCHES, Transcript.of(fp, fp))
        assertEquals(Transcript.FITS_NOT, Transcript.of("0".repeat(24), fp))
        assertEquals(Transcript.FITS_NOT, Transcript.of("XY".repeat(12), fp))
        assertEquals(Transcript.EMPTY, Transcript.of(" : ", fp))
    }

    @Test
    fun `the pin applies per host and port, only for https`() {
        assertEquals("brick.example.org:443", pinKey("https://Brick.Example.org/"))
        assertEquals("nas:8443", pinKey("https://nas:8443/brick"))
        assertNull(pinKey("http://nas:3000"))
    }

    @Test
    fun `a QR code carries the fingerprint along`() {
        val fp = spkiFingerprint(cert(LEAF))
        val p = parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc","fp":"$fp"}""")!!
        assertEquals(fp, p.fingerprint)
        assertNull(parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc"}""")!!.fingerprint)
    }

    @Test
    fun `a QR code with an unreadable fingerprint does not apply`() {
        assertNull(parseQrPayload("""{"url":"https://nas:8443","token":"bim:abc","fp":"kurz"}"""))
        val fp = spkiFingerprint(cert(LEAF))
        assertNull("A pin over http yields nothing", parseQrPayload("""{"url":"http://nas:3000","token":"bim:abc","fp":"$fp"}"""))
        assertNull(parseQrPayload("""{"url":"https://nas","token":"fremd"}"""))
    }

    /**
     * After a renewal with a new key under the same public root. Pins carry over
     * to the test server's new port, as with a restart of the same server.
     */
    private fun newServer(sheetKey: String, userCaTrust: List<String>) {
        val old = own()
        server.shutdown()
        server = MockWebServer()
        launch(sheetKey, userCaTrust)
        pins.map.filterKeys { it.startsWith(old) }.forEach { (k, v) -> pins.map[k.replaceFirst(old, own())] = v }
    }

    @Test
    fun `a new server key under the same public root deliberately asks`() {
        launch(PUB_SHEET_A_KEY, listOf(PUB_SHEET_A, PUB_ZW_A))
        assertFalse(fetch(system(PUB_ROOT)))
        assertTrue(question.confirm(pins, copied()))
        assertEquals("With the yes to the root the leaf is remembered too",
            spkiFingerprint(cert(PUB_SHEET_A)), pins.pin(sheetPinKey(own())))
        assertTrue(fetch(system(PUB_ROOT)))

        newServer(PUB_SHEET_B_KEY, listOf(PUB_SHEET_B, PUB_ZW_B))
        assertFalse("Another server key does not pass silently", fetch(system(PUB_ROOT)))
        assertEquals(0, server.requestCount)
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.KEY_NEW, f.kind)
        assertEquals(spkiFingerprint(cert(PUB_SHEET_A)), f.expected)
        assertEquals(spkiFingerprint(cert(PUB_SHEET_B)), f.fingerprint)
        assertEquals("The root pin stays", spkiFingerprint(cert(PUB_ROOT)), pins.pin(own()))
        assertTrue(f.transcriptNeeded)
        assertFalse("Without CT obligation a tap is not enough", question.confirm(pins))
        assertFalse("Typed off wrongly", question.confirm(pins, "00:11:22:33:44:55:66:77:88:99:AA:BB"))
        assertEquals(spkiFingerprint(cert(PUB_SHEET_A)), pins.pin(sheetPinKey(own())))
        assertTrue("Typed off, the new key applies", question.confirm(pins, copied()))
        assertEquals(spkiFingerprint(cert(PUB_SHEET_B)), pins.pin(sheetPinKey(own())))
        assertTrue(fetch(system(PUB_ROOT)))
    }

    @Test
    fun `with CT requirement a new server key needs the screen lock, not a transcript`() {
        launch(PUB_SHEET_B_KEY, listOf(PUB_SHEET_B, PUB_ZW_B))
        pins.rememberPin(own(), spkiFingerprint(cert(PUB_ROOT)))
        pins.rememberPin(sheetPinKey(own()), spkiFingerprint(cert(PUB_SHEET_A)))
        assertFalse(fetch(system(PUB_ROOT), ct = true))
        val f = question.open.value!!
        assertEquals(CertificateUnresolved.Kind.KEY_NEW, f.kind)
        assertFalse("The system checked CT", f.transcriptNeeded)
        assertTrue(f.deviceConfirmationNeeded)
        assertFalse("A tap alone does not change the key", question.confirm(pins))
        assertTrue("After the screen lock the new key applies", question.confirm(pins, deviceConfirmed = true))
        assertTrue(fetch(system(PUB_ROOT), ct = true))
    }

    @Test
    fun `without a remembered server key it is recorded on the first pass`() {
        launch(PUB_SHEET_A_KEY, listOf(PUB_SHEET_A, PUB_ZW_A))
        pins.rememberPin(own(), spkiFingerprint(cert(PUB_ROOT)))
        assertTrue("Older version without second pin: no question", fetch(system(PUB_ROOT)))
        assertNull(question.open.value)
        assertEquals(spkiFingerprint(cert(PUB_SHEET_A)), pins.pin(sheetPinKey(own())))
    }

    @Test
    fun `a code from the signed-in screen swaps the server key without a question`() {
        launch(PUB_SHEET_B_KEY, listOf(PUB_SHEET_B, PUB_ZW_B))
        pins.rememberPin(sheetPinKey(own()), spkiFingerprint(cert(PUB_SHEET_A)))
        pins.holdBefore(own(), spkiFingerprint(cert(PUB_ROOT)))
        assertTrue(fetch(system(PUB_ROOT)))
        assertNull(question.open.value)
        assertEquals(spkiFingerprint(cert(PUB_SHEET_B)), pins.pin(sheetPinKey(own())))
    }

    @Test
    fun `the server key binds only under a public root, an own CA renews silently`() {
        launch(RENEWED_SHEET1_KEY, listOf(RENEWED_SHEET1, RENEWED_ROOT))
        pins.rememberPin(own(), spkiFingerprint(cert(RENEWED_ROOT)))
        pins.rememberPin(sheetPinKey(own()), spkiFingerprint(cert(RENEWED_SHEET2)))
        assertTrue("Caddy renews its internal leaf every few hours", fetch(system(FOREIGN)))
        assertNull(question.open.value)
    }

    @Test
    fun `the same O= in the subject does not make a family, only the fixed list does`() {
        launch(FAM_SHEET1_KEY, listOf(FAM_SHEET1, FAM_ZW1))
        val both = system(FAM_X1, FAM_X2, PUB_ROOT)
        pins.rememberPin(own(), spkiFingerprint(cert(FAM_X2)))
        assertFalse("Same O=, but in no family", fetch(both, families = emptyMap()))
        assertEquals(CertificateUnresolved.Kind.CHANGED, question.open.value?.kind)
        question.discard()
        assertTrue("The same roots registered as a family", fetch(both))

        assertEquals(CA_FAMILIES["C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M="], CA_FAMILIES["diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI="])
        assertFalse("ISRG and Google are different operators",
            CA_FAMILIES["C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M="] == CA_FAMILIES["hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc="])
        assertTrue(CA_FAMILIES.keys.all { Base64.getDecoder().decode(it).size == 32 })
    }

    @Test
    fun `on first contact one may type, wrongly typed input does not apply`() {
        launch()
        assertFalse(fetch(system(ROOT), ct = true))
        assertEquals(CertificateUnresolved.Kind.FIRST_CONTACT, question.open.value?.kind)
        assertFalse("Typed off wrongly", question.confirm(pins, "00:11:22:33:44:55:66:77:88:99:AA:BB"))
        assertNull(pins.pin(own()))
        assertTrue("Typed off correctly", question.confirm(pins, copied()))
        assertTrue(fetch(system(ROOT), ct = true))
    }

    private companion object {
        val PW = "test".toCharArray()
        fun cert(b64: String): X509Certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(Base64.getDecoder().decode(b64).inputStream()) as X509Certificate

        /** The test roots X1 and X2 as one family, like ISRG Root X1 and X2 in [CA_FAMILIES]. */
        val PROBE_FAMILY: Map<String, String> by lazy {
            mapOf(spkiFingerprint(cert(FAM_X1)) to "Probe CA", spkiFingerprint(cert(FAM_X2)) to "Probe CA")
        }

        const val ROOT = "MIIBlTCCATugAwIBAgIUCbgn7Upu9fEAMGToKKauXo+baGUwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAXMRUwEwYDVQQDDAxCcmljayBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR8FJcl3BEyvVpJgfQ/T5qw/+pweuS6179KUZKyiCZGxiBp5q11Lyk/Z/qZ3lYWC8vf5F1vn/BNqU7bbKB3HhkPo2MwYTAdBgNVHQ4EFgQUXGDtWh02N49g+YF9OEkqvnoC1EgwHwYDVR0jBBgwFoAUXGDtWh02N49g+YF9OEkqvnoC1EgwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhALnFIf/TxItrcCD4WHUT6D3XfqsMqHQ8Rx7Qjc7304s4AiADtT8yG+NtvZHTDM/cmC/eJWf/LsA1xnJTA5yXuGlxzg=="
        const val INTER = "MIIBlzCCAT2gAwIBAgIUQyjZ8Us4p6zbuUu9OD8NEe+rg0IwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQnJpY2sgV3VyemVsMCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAZMRcwFQYDVQQDDA5CcmljayBad2lzY2hlbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKHmNbAOfGEGwyrPGQynBjdkBGW5x/8pNc/Lcpad3cW5GqsvY5WChv5QSJhnj/3jWqC/9hIcIgoOR6w1OsgpN16jYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBS/HkuEroFohODqD2wk4HPnlSdDQDAfBgNVHSMEGDAWgBRcYO1aHTY3j2D5gX04SSq+egLUSDAKBggqhkjOPQQDAgNIADBFAiAb/nz4SUy5/d2t/ci7w0eBD9c7HadJ4CcVtCs4ugUuFwIhAJAxMmuBap9q2jYYNRmSymGdOBt78fT12KETYQ4uWnaO"
        const val LEAF = "MIIBxDCCAWqgAwIBAgIUGKFt31uRyQEpo2/dyXJUnyNBQvQwCgYIKoZIzj0EAwIwGTEXMBUGA1UEAwwOQnJpY2sgWndpc2NoZW4wIBcNMjYxMDMwMTU0MjU4WhgPMjEyNjEwMDYxNTQyNThaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMRphX3E9F+1CxrClvKYvhQLC1GyRMM0KV6hemBqhqJ4ErxTmWWsCmCaLxc9ai0HRRVGcwRaTUYN2zwUwOruxrqjgZIwgY8wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwEwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMB8GA1UdIwQYMBaAFL8eS4SugWiE4OoPbCTgc+eVJ0NAMB0GA1UdDgQWBBTYiTrV8idg50suxhBOzVR4ehDuXjAKBggqhkjOPQQDAgNIADBFAiEAqVWMQNoCR/Qv0iDKhwjlSmbIpcj4QkkvEwOLQJjmWVkCIHbT27kp+E5rJEcyBRHjRi8lrrqHGMcGJY3hZQXm0rOc"
        /** Generated only for this test; protects nothing. */
        /** Caddy sign_with_root: leaf signed directly by the root (openssl). */
        const val CADDY_ROOT = "MIIBlTCCATugAwIBAgIUWfsD4SFXkS/uYDWYXA+OWZbAS0owCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAXMRUwEwYDVQQDDAxDYWRkeSBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASudcnAk+7NFzlNgXJlzLpv1WNLgSrYkYdxzHKOI9CAGktSDWCmqhJfXKbJezy/XJtJhb8No+g98CcCX+K4RZ7wo2MwYTAdBgNVHQ4EFgQULpDKa+iFWhIS/Vl4s94pdZYH43QwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgDuvgqOOE7zjj0LE3ZMADdJ6CbM9zLc9uZyPLXQIcJ24CIQDvseM//f4Ymtat2eDiE0guayf6MFBXQwVmUEAs/h5jsA=="
        const val ROOT_SHEET = "MIIBwjCCAWigAwIBAgIUJ5bQK16akXTtVJGiddkeeCeimhAwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMQ2FkZHkgV3VyemVsMCAXDTI2MTAzMDIyMjg0NFoYDzIxMjYxMDA2MjIyODQ0WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwHo4GSMIGPMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUAZczQX6xjqiWuzi8ceAiL8aMRSgwHwYDVR0jBBgwFoAULpDKa+iFWhIS/Vl4s94pdZYH43QwCgYIKoZIzj0EAwIDSAAwRQIhAIDDuQsj3wEuClpl1bZMDbJQ1fnXG3pDWbfkcK9Nbkj1AiAoe+I71U9V5jog/wz5Y5bOc2YbEAw1q+grLMsqMP1jUA=="
        const val ROOT_SHEET_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqZs7tPJIE6CpMc2pY0PdwG3yxUHoNpKYXMHNMTymB+KhRANCAAQkCXdFDKqjNGrBKlNNRxL4eL+CDWRzYEeNTxLPedxdqAmZELd0QILkTpIU3gnrMSNC92sr9JqJMj6bI6rbtqwH"
        const val LEAF_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg84oF2kTvPuV0IbWxEBoJyR56Fy+0F8JahbFGp5BLWNyhRANCAATEaYV9xPRftQsawpbymL4UCwtRskTDNCleoXpgaoaieBK8U5llrApgmi8XPWotB0UVRnMEWk1GDds8FMDq7sa6"
        /** A root with two leaves of different keys: the renewal with Caddy. */
        const val RENEWED_ROOT = "MIIBpzCCAU2gAwIBAgIUJTOasEJOl0Pf7j0Qu01Sy8psgtYwCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVQ2FkZHkgV3VyemVsIEVybmV1ZXJ0MCAXDTI2MTEwMTA3MjY1MVoYDzIxMjYxMDA4MDcyNjUxWjAgMR4wHAYDVQQDDBVDYWRkeSBXdXJ6ZWwgRXJuZXVlcnQwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATiMyAJAa2zn6z/XzWP4N3gXVIwrNsjX3N7XNaRTwZl+kMBDrdiCWGvXlzeW4SlhxzXNuRKMVZspa9oLozWu4Ylo2MwYTAdBgNVHQ4EFgQUqmjAp54LnvWA/rxJuUqmA46NfbUwHwYDVR0jBBgwFoAUqmjAp54LnvWA/rxJuUqmA46NfbUwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhAKkqowjQxkTgYQT0X1D1/pH9AqbLfH4GRWLX/6l6x65yAiAvBcvxLwaniZ8UBE66GQyRR7OQqpBWiCvnVItju+uT7A=="
        const val RENEWED_ROOT_HEX = "8E:04:B3:9F:BF:A3:2D:A2:18:32:DB:2F:50:22:4C:2D:DE:96:AF:3A:0E:CA:01:05:95:E8:5F:1E:00:69:84:AB"
        const val RENEWED_SHEET1 = "MIIBxzCCAW6gAwIBAgIUNED1j2vQniFdnw4NBBoyn5y9NsswCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVQ2FkZHkgV3VyemVsIEVybmV1ZXJ0MCAXDTI2MTEwMTA3MjY1MVoYDzIxMjYxMDA4MDcyNjUxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARo3O3gBYVKoZ258LnBNzokFNZYa9re0sQVASwdqdtSNmwkXYr3Oin1u7J8CHuUKU5Wnj239xhxTcysx1s75gkAo4GPMIGMMAkGA1UdEwQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUvoABbHxaUxwgnYAuitc4oBTOhSYwHwYDVR0jBBgwFoAUqmjAp54LnvWA/rxJuUqmA46NfbUwCgYIKoZIzj0EAwIDRwAwRAIgJd7x9uBMAYsvqpKWq3OPtjOWKNHFEDca2A6bL+jKAigCIGwQ/YZBhOwuQgG9IZYsbsN/WOVzMgL0kInoq8EnJdFr"
        const val RENEWED_SHEET1_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQghRyFpO/jlqgF52U0y5wFGuYiEhYlqjn1ua2/I+YlOlKhRANCAARo3O3gBYVKoZ258LnBNzokFNZYa9re0sQVASwdqdtSNmwkXYr3Oin1u7J8CHuUKU5Wnj239xhxTcysx1s75gkA"
        const val RENEWED_SHEET2 = "MIIByTCCAW6gAwIBAgIUNED1j2vQniFdnw4NBBoyn5y9NswwCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVQ2FkZHkgV3VyemVsIEVybmV1ZXJ0MCAXDTI2MTEwMTA3MjY1MVoYDzIxMjYxMDA4MDcyNjUxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARW/sryEYeErhUzXKqmM/ZH8rtumVlk4/NOugkM98U5wWirXfFozbsceyOHTb6cZdwtsOb+R3MjM1T8yhe8ZBHYo4GPMIGMMAkGA1UdEwQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQUrufLzJG5jvOE0ZNVIgUuFsKOjt8wHwYDVR0jBBgwFoAUqmjAp54LnvWA/rxJuUqmA46NfbUwCgYIKoZIzj0EAwIDSQAwRgIhALePJ9a9k9vdjKBxDuPGn9kIP5juXHCBuHjy49hb5EH1AiEA/qkkQkBKdBYF7ECQnwAnobnpIyIcGyfQ/MN1UO/z2dE="
        const val RENEWED_SHEET2_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSfcmm6eyJEzmbUxAk9UHevRKVQMhEqMn242fIEhY7aWhRANCAARW/sryEYeErhUzXKqmM/ZH8rtumVlk4/NOugkM98U5wWirXfFozbsceyOHTb6cZdwtsOb+R3MjM1T8yhe8ZBHY"
        /** A public CA in miniature: one root, two intermediates each with one leaf (openssl). */
        const val PUB_ROOT = "MIIBpDCCAUmgAwIBAgIUZIFCnfxNIQRpMPTNwW7BSSFDv80wCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMYW+yzOBBNjAat0l/sP4W3ZgRVDK5kCmFCH5Dv7185TkPr5k7scjn/974EXTVvZDYU1LPsZmW3gXy0FNGysUC+jYzBhMB0GA1UdDgQWBBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNJADBGAiEAp6GVM9JkGHL6UnRaaidFdJ2KXTkT5dVarFiyfXTEfDACIQDl6sX2VT243lSNJtFFpU3znF+GxV7T8KstC/lIGpQA/g=="
        const val PUB_ROOT_HEX = "F4:5D:D3:BE:46:44:4D:61:F1:CD:DE:03:92:B3:C5:8A:73:F3:33:DC:60:9D:AC:42:BD:C0:BB:CC:FE:19:E0:FB"
        const val PUB_ZW_A = "MIIBoDCCAUagAwIBAgIUAQU1sXdBgqFF38Hi+ijuOG1hvwYwCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABOWdioVQKAOBRw6UiEyIXBhIl95junXb8p6oGzTDkKJWw4zE7efq82EiL0JrvnkWQziXaTCAzYqVk3xnwHqv4KSjYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBTQ5IolVueozviLke93UtJ6G3Y0EDAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAKBggqhkjOPQQDAgNIADBFAiEA/5LLzEGDA7tkDnrGKtFmUDSyWyNizCD47OaVWdjPKjsCIFH/YtymGArW/cxrFfMpLjvPzmV3bh2fen18oGROYQLj"
        const val PUB_ZW_B = "MIIBnzCCAUagAwIBAgIUAQU1sXdBgqFF38Hi+ijuOG1hvwcwCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwTT2VmZmVudGxpY2hlIFd1cnplbDAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABDEgpbf+s6SGWZj/quaQtakWiv4xWus5vjua3ax1UXeC9LoJh5UtlfkGbQ2wXR3EFesZjh3BGkrJhJY0asO6VkijYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBQ/oP7MODYtWp9Gyzs6MtDPBmJIMDAfBgNVHSMEGDAWgBRCHCEEa57KCCRJiaZxWSJ9GDEjCTAKBggqhkjOPQQDAgNHADBEAiAK9OlzxqHfohUqtdRNpFUoOF4gPAqXPhPhlObB0JtBgQIgIZ0y638KPcdq6B1hVzLB3YARfLe32J/MhJExn8bcWKk="
        const val PUB_SHEET_A = "MIIBxjCCAWygAwIBAgIUEBLGo7NHqNVaaJN74wAlRIwi4W4wCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYTAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjqRhSfxnpKW8SVpXa+tPaRt6Vlwq2CmtlrBmms1LDiwh0W5nor0jmmIAf+DK2BrKpAgzdtTPsylxmTjIGpnezqOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFOw0VRfHzwggapzdIqYWyzwb8jflMB8GA1UdIwQYMBaAFNDkiiVW56jO+IuR73dS0nobdjQQMAoGCCqGSM49BAMCA0gAMEUCIQDYuBBmG4miA9O95DWJ35JamLrl6Hiz9MlCl3EzYekrRwIgebgFsZ6Ob4etGqT4Bk/zA2N4eMcO9yAtUeQrQ04sNsU="
        const val PUB_SHEET_A_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgHVYb+/H8EyhvizzUS3y9TAt7FlkQtQTQ67/8+ih/YaihRANCAASOpGFJ/GekpbxJWldr609pG3pWXCrYKa2WsGaazUsOLCHRbmeivSOaYgB/4MrYGsqkCDN21M+zKXGZOMgamd7O"
        const val PUB_SHEET_B = "MIIBxjCCAWygAwIBAgIUMZo/EI4H/XOHp4BTSLv9bt1IR58wCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWndpc2NoZW5zdGVsbGUgYjAgFw0yNjExMDExNTU3MDdaGA8yMTI2MTAwODE1NTcwN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2E8WBySJmiIWknMzbepPni3bP68iZpP3c2WwBCqoEMZb8ppgaIFnfP4x8FfQwxmbblOfnAK9qIpIMMOKcqJLhKOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFG5BwbuRc8QPiyQocRkuaHnm7J03MB8GA1UdIwQYMBaAFD+g/sw4Ni1an0bLOzoy0M8GYkgwMAoGCCqGSM49BAMCA0gAMEUCIQCvJtbBc2pqUGlh8evmznKK1G/O8iW531jJlET2gYW5KwIgDINFCTJgae8SPreE2VipqiyzSncwBRglIT3Sw1EcC6M="
        const val PUB_SHEET_B_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg7LsVCGLBPHR5qR7tBe+zQWeT/RemLJNrPJ7SFpGNHwyhRANCAATYTxYHJImaIhaSczNt6k+eLds/ryJmk/dzZbAEKqgQxlvymmBogWd8/jHwV9DDGZtuU5+cAr2oikgww4pyokuE"
        /** A second public root with a leaf, for the root change (openssl). */
        const val PUB2_ROOT = "MIIBqDCCAU2gAwIBAgIUeQfiSvXaOs9VQ7JOTGuYq9+9io8wCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVT2VmZmVudGxpY2hlIFd1cnplbCAyMCAXDTI2MTEwMjA0NDcyMFoYDzIxMjYxMDA5MDQ0NzIwWjAgMR4wHAYDVQQDDBVPZWZmZW50bGljaGUgV3VyemVsIDIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARXPBIUHUcx0gndNtCFWOsc9VK1UCPYVdTt/elmdGtOr+QqU+2kj82x5bM5PwwxyeTMI0l/0m7+IhRHasjTD3wAo2MwYTAdBgNVHQ4EFgQUNiOkY9V+q2qKkLNO3YzYDvJSMtgwHwYDVR0jBBgwFoAUNiOkY9V+q2qKkLNO3YzYDvJSMtgwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSQAwRgIhAOtFyStygsxuZ82WUpQfgs4yEc9yd5SHXzEeM5gxXWiHAiEAxq1QdZDQEZLbpSZkktaMa/gUng+ruXUCb7bbSSw+VW4="
        const val PUB2_SHEET = "MIIByjCCAXGgAwIBAgIUBZldxIW8pDuyAwDmNEUH+CvVA/8wCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVT2VmZmVudGxpY2hlIFd1cnplbCAyMCAXDTI2MTEwMjA0NDcyMFoYDzIxMjYxMDA5MDQ0NzIwWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR3UZCup1reCVwcdpUWXuBroLN2Ae2orBEjO/63RFn9ppwOTZcXNQbuX2J20HqKFM7F5pgpPdZWoCx5CuuTDLkco4GSMIGPMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAdBgNVHQ4EFgQU0+JHa2fUKgS1c8Qpf2MPvkf10x0wHwYDVR0jBBgwFoAUNiOkY9V+q2qKkLNO3YzYDvJSMtgwCgYIKoZIzj0EAwIDRwAwRAIgaI3NXaJqaJPF9F3F5MA/uHYXmLEMDGlz2rerz62IXIACIGGccRCorHmF04MB3oFogbyx7s3cjhOWNIM2PivVGTsj"
        const val PUB2_SHEET_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgkJUGxWpt9r1Mxq/Kodx7mWejKYEWCr0nz2zAkQCUrm2hRANCAAR3UZCup1reCVwcdpUWXuBroLN2Ae2orBEjO/63RFn9ppwOTZcXNQbuX2J20HqKFM7F5pgpPdZWoCx5CuuTDLkc"
        /** A root family (O=Probe CA, X1 and X2) each with an intermediate and a leaf (openssl). */
        const val FAM_X1 = "MIIB1zCCAX2gAwIBAgIUJzODbuMp49O7i9PzkV2w30gxC1IwCgYIKoZIzj0EAwIwODELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMRYwFAYDVQQDDA1Qcm9iZSBSb290IFgxMCAXDTI2MTExMjIyNDIxNloYDzIxMjYxMDE5MjI0MjE2WjA4MQswCQYDVQQGEwJDSDERMA8GA1UECgwIUHJvYmUgQ0ExFjAUBgNVBAMMDVByb2JlIFJvb3QgWDEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARUuNHmd9ah+QgGgJ69U5FFqEDfJHZTcplKMoUTx9uqtnXkt0nNga3rKkFE8nUBs+mQxbxhs6H8hJONXLPoj/3do2MwYTAdBgNVHQ4EFgQU5H1nzHcaWbbCNal8WpErpY3lI58wHwYDVR0jBBgwFoAU5H1nzHcaWbbCNal8WpErpY3lI58wDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgHnVYf7Uk3an/+ENuf4UmjAXTNj1LVXRhn6GnI157qXoCIQDYdqvLYvqR9Uf6AynUCULrbJPWP8cnnakq5zfbO76rOw=="
        const val FAM_X2 = "MIIB2DCCAX2gAwIBAgIUZheftwIsVO/Lw4GKHC17PDM9IW4wCgYIKoZIzj0EAwIwODELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMRYwFAYDVQQDDA1Qcm9iZSBSb290IFgyMCAXDTI2MTExMjIyNDIxNloYDzIxMjYxMDE5MjI0MjE2WjA4MQswCQYDVQQGEwJDSDERMA8GA1UECgwIUHJvYmUgQ0ExFjAUBgNVBAMMDVByb2JlIFJvb3QgWDIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASVMxFZrHfC3rLaN+X+89rBSb9Y5FQM/jyQsho9YVNduoktegRSTXsgo2/c0bc3n0jcvm1LjpgA3kR7UrjuqhB1o2MwYTAdBgNVHQ4EFgQUSWxTgGmf7qCPhpF4+oTEdFfbt1AwHwYDVR0jBBgwFoAUSWxTgGmf7qCPhpF4+oTEdFfbt1AwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSQAwRgIhAO4LW747aWqnQQLBec/8WFJVoyFn0ZPFQrCj9kS9iOheAiEAykAmF3X2ienlupzTv9sg0H4idHw7+TrhBzq1ttXUkAo="
        const val FAM_ZW1 = "MIIB1TCCAXugAwIBAgIUcxqXDLMucdnJUvdXSU200z/6CpEwCgYIKoZIzj0EAwIwODELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMRYwFAYDVQQDDA1Qcm9iZSBSb290IFgxMCAXDTI2MTExMjIyNDIxNloYDzIxMjYxMDE5MjI0MjE2WjAzMQswCQYDVQQGEwJDSDERMA8GA1UECgwIUHJvYmUgQ0ExETAPBgNVBAMMCFByb2JlIFIxMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESI0Y95hHR15r9CTFyMw2fg66mx/UMLiGlBb5h5iRfEz8XkHrCfY8gH3hy5Fy+yKOj9RdQzMaYhj+Pjovl/HIwKNmMGQwEgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFCKWzIu4eTvpk2kmEcALVu++zsPCMB8GA1UdIwQYMBaAFOR9Z8x3Glm2wjWpfFqRK6WN5SOfMAoGCCqGSM49BAMCA0gAMEUCIQD5+HD2WNxENATDGHNxHydbh7TyR9JOSYMA27b3qslWrgIgVlCWtn8GGQMCDZCUcr5qG2dFquSChq0d30PJlOAEkwQ="
        const val FAM_ZW2 = "MIIB1jCCAXugAwIBAgIUTviRjd59mbAE1uyWwEBG8VdX1LUwCgYIKoZIzj0EAwIwODELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMRYwFAYDVQQDDA1Qcm9iZSBSb290IFgyMCAXDTI2MTExMjIyNDIxNloYDzIxMjYxMDE5MjI0MjE2WjAzMQswCQYDVQQGEwJDSDERMA8GA1UECgwIUHJvYmUgQ0ExETAPBgNVBAMMCFByb2JlIEUxMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE8C1AlzWJOhFrt+uXMezg2KEW01EJjKsmj7r3mfEnE4bRlm53a4s+tDHMv3XFifq0qz12oRoi0JnWmi/LjAxjJqNmMGQwEgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFKGSGBMlJLt7iP5WeAUnB5uh7xNgMB8GA1UdIwQYMBaAFElsU4Bpn+6gj4aRePqExHRX27dQMAoGCCqGSM49BAMCA0kAMEYCIQDFExiLUmuKfN8fzuDuMPkhApZ9U8kDWVWrsG0s8qQ/hwIhAKphh7yr0+RQvSf6Lm05TotgCCRhLayqaePQHxFVAa8N"
        const val FAM_SHEET1 = "MIIB2jCCAYGgAwIBAgIUT34beNuro6nHUHATsfzY+INQt1owCgYIKoZIzj0EAwIwMzELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMREwDwYDVQQDDAhQcm9iZSBSMTAgFw0yNjExMTIyMjQyMTZaGA8yMTI2MTAxOTIyNDIxNlowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEG4mfnp0oEjncOmSXTH83HhI1O5ycvivUz8ohJNHl69iSp6ROieEYhknl++4BsMNY01tV/jYJRLwl4xkcb4YwTqOBjzCBjDAJBgNVHRMEAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFDpGZaw1mk5rlgejdKfBVuNXmrcsMB8GA1UdIwQYMBaAFCKWzIu4eTvpk2kmEcALVu++zsPCMAoGCCqGSM49BAMCA0cAMEQCIFKXCXL3fz+yTXVpMtuqe1eGa0vvoDsfa1M99xkw0U+YAiAfy2Hnhd+IpZ8O7573E9OEojFqjXiW6nHx+nRTKNJbQw=="
        const val FAM_SHEET1_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgMnzKdS6G8eGJ9bCUBVAQXpo7Nw1S/dE8KgE9q/FgoA6hRANCAAQbiZ+enSgSOdw6ZJdMfzceEjU7nJy+K9TPyiEk0eXr2JKnpE6J4RiGSeX77gGww1jTW1X+NglEvCXjGRxvhjBO"
        const val FAM_SHEET2 = "MIIB2zCCAYGgAwIBAgIUXFbE1wHFPMfHZBZE/OQCukz4F3MwCgYIKoZIzj0EAwIwMzELMAkGA1UEBhMCQ0gxETAPBgNVBAoMCFByb2JlIENBMREwDwYDVQQDDAhQcm9iZSBFMTAgFw0yNjExMTIyMjQyMTZaGA8yMTI2MTAxOTIyNDIxNlowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEATeMiZj5Q+Jg96WuokKkgVVY2Vl8BgGvnPO/m+FTqkObHl1hOSYcPyF0kICrdg2vS3BWr4V11KJ8+WBVdG0rx6OBjzCBjDAJBgNVHRMEAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYDVR0OBBYEFMtJdC/hyPnfWeAFrLSRa/s519VQMB8GA1UdIwQYMBaAFKGSGBMlJLt7iP5WeAUnB5uh7xNgMAoGCCqGSM49BAMCA0gAMEUCIQDzcg4cy2wilhPGJ+M4abqHPN2RU4janMtiuTUStwt8/gIgIiw1cNAS9LlNkHuzbpCiTcXHVFvcWM7sF176t5lq24Y="
        const val FAM_SHEET2_KEY = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgck9Ek03fOxXwdbOymEx7SBLzTYC58mv7FEPm0b73XrOhRANCAAQBN4yJmPlD4mD3pa6iQqSBVVjZWXwGAa+c87+b4VOqQ5seXWE5Jhw/IXSQgKt2Da9LcFavhXXUonz5YFV0bSvH"
        const val FOREIGN = "MIIBmDCCAT6gAwIBAgIUBpLM0+8DZR9WqDw7DqtrEKH9KDswCgYIKoZIzj0EAwIwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAzMDE1NDI1OFoYDzIxMjYxMDA2MTU0MjU4WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATSAfTFPtfDF3dy0bcjX8dCElM9oKs2NYwoZEyfWsb5EIpbYtqP7F6JCLbrsb7GVytdEqsatNJDifymfYNnIJPjo2wwajAdBgNVHQ4EFgQU5NOS8aVLD/bPQjWQ5foWE5AcTIQwHwYDVR0jBBgwFoAU5NOS8aVLD/bPQjWQ5foWE5AcTIQwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMAwGA1UdEwEB/wQCMAAwCgYIKoZIzj0EAwIDSAAwRQIgD2hCTe+02K17PzDfV7EgrTEgIV1C99ShlLSwHZsc1IICIQCknNnfSKSNOc+Kilyyna8ag4H9A8XH9kfcAia1XVWbDg=="
    }
}
