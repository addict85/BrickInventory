package ch.brickinventoryapp.login

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.login.ui.PasskeyQuery
import ch.brickinventoryapp.login.ui.PasskeyResult
import ch.brickinventoryapp.login.ui.viewmodel.AnmeldungViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.FilterStore
import ch.brickinventoryapp.login.ui.QrAccount
import java.util.Base64
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.SessionFake
import ch.brickinventoryapp.testing.StorageStore
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestDienste
import ch.brickinventoryapp.security.PinStore
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.CertificateQuestion

/**
 * Das Anmelde-ViewModel, ausgeführt gegen einen PfadServer ohne Netz und eine Ablage im
 * Speicher.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen AnmeldungViewModel.kt):
 *   A  in angemeldet() loginBegins() NACH dem Token → rot „eine Anmeldung
 *      leert die Filter, legt den Token ab …“ (die Reihenfolge wird mitgeschrieben)
 *   B  beim zweiten Faktor den Fehler auch ohne Code gezeigt → rot „beim ersten
 *      Mal fragt der zweite Faktor nur nach dem Code“
 *   C  in qrFailed() den Satz immer gesetzt → rot „ein zweiter QR-Anlauf
 *      nach gelungener Anmeldung meldet keinen Fehler“
 *   D  zuruecksetzen() leer → rot „nach dem Abmelden ist das Formular leer“
 *   E  in setUpOne() den Aufruf sessionService.abmelden() entfernt → rot „ein anderer Server
 *      meldet vor der neuen Adresse ab“ (der QR-Weg meldet seit S2 erst nach dem Ja ab, siehe AC)
 *   F  sameOrigin() durch `!=` der rohen Texte ersetzt → rot „derselbe
 *      Server mit Schrägstrich meldet nicht ab“
 *   G  in saveServerUrl() die Prüfung adressfehler() entfernt → rot
 *      „eine http-Adresse wird nicht gespeichert“
 *   H  in loginWithQrToken() die Prüfung entfernt → rot „ein
 *      QR-Code mit http-Adresse …“ (Adresse gespeichert, qr-login gerufen)
 *   I  rememberPin() in loginWithQrToken() nach qrLogin() → rot „ein
 *      QR-Code mit Fingerabdruck pinnt vor der ersten Anfrage“ (Test seit O–Q
 *      umgeschrieben: vorgehalten statt gemerkt)
 *   O  in loginWithQrToken() wieder rememberPin() statt holdBefore() vor qrLogin() →
 *      rot „ein gescheiterter QR-Code hinterlaesst keinen Pin“ und „… haelt den
 *      Pin … vor“
 *   P  die Prüfung bisherigerPin() vor dem Start entfernt → rot „ein QR-Code
 *      mit anderem Schluessel ersetzt den Pin nie still“
 *   R  die Prüfung bestaetigtFingerabdruck() in loginWithQrToken()
 *      durch `pinSwitchInput == null` ersetzt (jede Eingabe genügt) → rot
 *      „ein QR-Code mit anderem Schluessel ersetzt den Pin nie still“ (falsch
 *      abgeschriebener Wert angenommen)
 *   Q  das finally mit forgetRetained() entfernt → rot „ein gescheiterter
 *      QR-Code hinterlaesst keinen Pin“ (Zeitüberschreitung, nichts vergessen)
 *   J  LoginRequest wieder mit festem neverExpires = true → rot
 *      „ein Token ohne Ablauf nur ueber https“ (http-Teil)
 *   K  PasskeyAnmeldung mit mitToken = false → rot „mit Passkey
 *      anmelden legt den Token ab …“
 *   L  Abgebrochen wie NoPasskey mit Satz → rot „ein
 *      abgebrochener Passkey-Dialog …“
 *   M  SecondFactorRoutes im AccountRepository nicht gelesen → rot
 *      „der zweite Faktor nimmt den Passkey …“ (Knopf fehlt)
 *   N  passkeyStattCode() reicht den Passkey nicht an login() →
 *      rot „der zweite Faktor nimmt den Passkey …“ (kein passkey im Rumpf)
 *   S  in fetchPasskey() RpIdFinding.FOREIGN durchgelassen → rot
 *      „Optionen fuer eine fremde Domain …“ und „Optionen ohne rpId … zweiten Faktor“
 *   T  RpIdFinding.MISSING durchgelassen → rot „Optionen ohne rpId …“
 *   U  checkRpId() mit ignoreCase und Unterdomänen (`host.endsWith("." + rpId)`)
 *      → rot „Optionen fuer eine fremde Domain …“
 *   V  die Prüfung der Adresse nach dem Dialog entfernt → rot „wechselt die
 *      Adresse waehrend des Passkey-Dialogs …“
 *   W  FINGERPRINT_TYPE_IN = 16 → rot „ein QR-Code mit anderem Schluessel
 *      ersetzt den Pin nie still“ (16 Zeichen angenommen)
 *   X  mussAbtippen() ohne Pin wieder `false` (Stand davor: ein Tipp
 *      genügte beim ersten Einrichten) → rot „ein eigener Schluessel aus dem
 *      QR-Code gilt beim ersten Einrichten nur abgetippt“;
 *      gegenproben/qr-pin-ohne-abtippen.patch
 *   Y  in pairQr() die Frage nach dem Konto übergangen (immer Ja) →
 *      rot „eine QR-Anmeldung zeigt Konto und Server …“; gegenproben/qr-ohne-kontofrage.patch
 *   Z  beim Nein discardQr() nicht gerufen → rot „ein Nein zum gezeigten
 *      Konto …“; gegenproben/qr-nein-ohne-verwerfen.patch
 * Gegenproben zum Serverwechsel per QR (12.11.2026 angelegt; ohne Gradle nur in der CI messbar):
 *   AC loginWithQrToken() wieder mit setUpOne() vor dem Abruf (sofort abmelden) → rot
 *      „ein Nein zum Konto eines anderen Servers …“ und „… erst nach dem Ja …“;
 *      gegenproben/qr-wechsel-meldet-sofort-ab.patch
 *   AD in qrFailed() ohne `!pairingWithSwitch` → rot „scheitert die Kopplung mit
 *      einem anderen Server …“ (Fehler verschluckt); gegenproben/qr-wechsel-fehler-verschluckt.patch
 *   AE in leavePreviousServer() ohne `kopplungsziel(null)` → rot „… erst nach dem Ja …“
 *      (abgemeldet, solange die Anfragen noch an den neuen Server gingen);
 *      gegenproben/qr-wechsel-abmelden-am-neuen.patch
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {

    /** Schreibt mit, was in welcher Reihenfolge abgelegt wird. */
    private class Ablage(var url: String = "https://server") : Anmeldeablage {
        val protokoll = Collections.synchronizedList(mutableListOf<String>())
        override suspend fun serverUrlJetzt() = url
        override suspend fun saveServerUrl(url: String) { this.url = url; protokoll += "url:$url" }
        override suspend fun saveAuthToken(token: String) { protokoll += "token:$token" }
        override suspend fun saveUsername(name: String) { protokoll += "name:$name" }
        val pins = ConcurrentHashMap<String, String>()
        override fun rememberPin(schluessel: String, fingerabdruck: String) {
            pins[schluessel] = fingerabdruck; protokoll += "pin:$schluessel=$fingerabdruck"
        }
        override fun rememberedPin(schluessel: String): String? = pins[schluessel]
        override fun holdBefore(schluessel: String, fingerabdruck: String) { protokoll += "vor:$schluessel=$fingerabdruck" }
        override fun forgetRetained(schluessel: String) { protokoll += "vergiss:$schluessel" }
        override fun kopplungsziel(url: String?) { protokoll += "ziel:$url" }
    }

    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste
    private lateinit var ablage: Ablage
    private lateinit var frage: CertificateQuestion

    /** Die Filterablage meldet ihr Leeren in dasselbe Protokoll; [roots] spielt die System-Wurzeln. */
    private fun vm(roots: Set<String> = emptySet()): AnmeldungViewModel {
        val viewStore = object : FilterStore by StorageStore() {
            override suspend fun everythingForgotten() { ablage.protokoll += "filter-leer" }
        }
        val blickfeld = Scope(viewStore,
            testHouseholdRepository(t.api),
            testPartsRepository(t.api))
        val abmelden = SessionFake { ablage.protokoll += "abmelden" }
        return t.merke(AnmeldungViewModel(t.sitzung, blickfeld, t.hinweise, abmelden,
            testAccountRepository(t.api), ablage, frage) { it in roots })
    }

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        paths = PfadServer()
        t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
        ablage = Ablage()
        frage = CertificateQuestion()
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `eine Anmeldung leert die Filter, legt den Token ab und meldet die Sitzung`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"voll","never_expires":false}}"""
        val vm = vm()
        vm.setFullAccess(true)
        vm.login("marco", "geheim")
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertEquals(listOf("filter-leer", "token:abc", "name:marco"), ablage.protokoll)
        assertTrue(paths.koerper.single(), "\"scope\":\"voll\"" in paths.koerper.single())
        assertTrue(t.sitzung.state.value.isAdmin)
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
    }

    /**
     * Ohne das Häkchen ein Token mit Scope "app": Das Kontorecht allein macht in
     * der App keinen Verwalter, der Server wiese dessen Aufrufe mit 403 ab.
     * Gegenprobe: in AnmeldungViewModel `r.data.verwalter`
     * → `r.data.user?.isAdmin == true` → rot „Verwalterkonto ohne Häkchen …“.
     */
    @Test
    fun `Verwalterkonto ohne Häkchen meldet sich ohne Verwalterrechte an`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"app","never_expires":false}}"""
        val vm = vm()
        vm.login("marco", "geheim")
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertTrue(paths.koerper.single(), "\"scope\":\"app\"" in paths.koerper.single())
        assertFalse(t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `beim ersten Mal fragt der zweite Faktor nur nach dem Code`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":false,"zweiter_faktor":true,"error":"Code fehlt"}"""
        paths.codes["/api/v1/auth/login"] = 401
        val vm = vm()
        vm.login("marco", "geheim")
        assertTrue("Codefeld", vm.anmeldeState.value.codeNoetig)
        assertNull("Ohne eingegebenen Code ist das kein Fehler", vm.anmeldeState.value.anmeldung.errorMessage)
        assertFalse("Ohne `passkey: true` kein Passkey-Knopf", vm.anmeldeState.value.passkeyStattCode)

        vm.login("marco", "geheim", code = "123456")
        assertTrue("Satz des Servers", vm.anmeldeState.value.anmeldung.errorMessage != null)
        assertEquals("Code fehlt", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue(ablage.protokoll.none { it.startsWith("token:") })
    }

    @Test
    fun `ein zweiter QR-Anlauf nach gelungener Anmeldung meldet keinen Fehler`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":false,"error":"Ungültiges oder abgelaufenes Token"}"""
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://server/", "einmalig")
        assertTrue("Antwort", paths.requestsAn("qr-login").isNotEmpty() && !vm.anmeldeState.value.anmeldung.laeuft)
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)
        assertEquals("Derselbe Server: keine Abmeldung", "url:https://server", ablage.protokoll.first())
    }

    private val fp = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
    private val fpAlt = Base64.getEncoder().encodeToString(ByteArray(32) { 9 })

    @Test
    fun `ein QR-Code mit Fingerabdruck haelt den Pin fuer die erste Anfrage vor und merkt ihn erst danach`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm(roots = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        vm.decideQrAccount(true)
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn && ablage.protokoll.any { it.startsWith("vergiss:") })
        val p = ablage.protokoll.toList()
        assertEquals("vor:brick.example.org:443=$fp", p.first())
        assertTrue("Gemerkt nach der Adresse, vor dem Token: $p",
            p.indexOf("url:https://brick.example.org") < p.indexOf("pin:brick.example.org:443=$fp") &&
                p.indexOf("pin:brick.example.org:443=$fp") < p.indexOf("token:abc"))
        assertEquals(fp, ablage.pins["brick.example.org:443"])
    }

    /** Der Handshake des ersten qr-login fragt nach dem Zertifikat und bricht ab (503 statt TLS). */
    private fun firstContactOnFirstQrLogin() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        var erster = true
        paths.priority = { _, pfad ->
            if (erster && pfad == "/api/v1/auth/qr-login") {
                erster = false
                frage.melde(CertificateUnresolved("brick.example.org:443", fp, CertificateUnresolved.Art.ERSTKONTAKT, ctForced = true))
                503 to """{"success":false}"""
            } else null
        }
    }

    private val pinsTheStore = object : PinStore {
        override fun pin(schluessel: String) = ablage.rememberedPin(schluessel)
        override fun rememberPin(schluessel: String, fingerabdruck: String) = ablage.rememberPin(schluessel, fingerabdruck)
    }

    @Test
    fun `nach dem Ja zum Erstkontakt meldet sich der QR-Code ohne neuen Scan an`() {
        firstContactOnFirstQrLogin()
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x")
        assertTrue("Wartet auf den Dialog statt „Keine Verbindung“", vm.anmeldeState.value.anmeldung.laeuft)
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)

        assertTrue(frage.confirm(pinsTheStore))
        assertEquals("Zweiter Versuch", 2, paths.requests.count { it == "POST /api/v1/auth/qr-login" })
        vm.decideQrAccount(true)
        assertTrue("angemeldet: ${ablage.protokoll}", t.sitzung.state.value.isLoggedIn)
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)
    }

    @Test
    fun `nach dem Nein zum Erstkontakt bleibt es bei einem Versuch`() {
        firstContactOnFirstQrLogin()
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x")
        frage.verwerfen()
        assertEquals(1, paths.requests.count { it == "POST /api/v1/auth/qr-login" })
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
        assertNotNull(vm.anmeldeState.value.anmeldung.errorMessage)
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `ein gescheiterter QR-Code hinterlaesst keinen Pin`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":false,"error":"Ungültiges oder abgelaufenes Token"}"""
        val vm = vm(roots = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertTrue("Antwort", ablage.protokoll.any { it.startsWith("vergiss:") })
        assertTrue(paths.requestsAn("qr-login").isNotEmpty())
        assertTrue("Nichts dauerhaft: ${ablage.protokoll}", ablage.pins.isEmpty())
        assertEquals("vergiss:brick.example.org:443", ablage.protokoll.last())
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `ein QR-Code mit anderem Schluessel ersetzt den Pin nie still`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        ablage.pins["brick.example.org:443"] = fpAlt
        val vm = vm()
        assertEquals("Der Bildschirm bekommt den bisherigen", fpAlt, vm.bisherigerPin("brick.example.org", fp))
        assertNull("Derselbe ist kein Wechsel", vm.bisherigerPin("https://brick.example.org/", fpAlt))

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertEquals("t${R.string.setup_qr_pin_wechsel_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue("Ohne Bestätigung nichts: ${ablage.protokoll}", ablage.protokoll.isEmpty())
        assertTrue(paths.requestsAn("qr-login").isEmpty())
        assertEquals(fpAlt, ablage.pins["brick.example.org:443"])

        // Ein Tipp mit falsch abgeschriebenem Wert genügt ebenso wenig.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "09:09:09:09:09:09:09:09:09:09:09:09")
        assertEquals("t${R.string.setup_qr_pin_wechsel_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue("Falsch abgeschrieben: nichts", paths.requestsAn("qr-login").isEmpty())

        // 16 Zeichen (64 Bit) genügen nicht mehr.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "07:07:07:07:07:07:07:07")
        assertEquals("t${R.string.setup_qr_pin_wechsel_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)

        // Die letzten 24 Hex-Zeichen des neuen Fingerabdrucks, wie aus der Webapp abgeschrieben.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "07:07:07:07:07:07:07:07:07:07:07:07")
        vm.decideQrAccount(true)
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertEquals("Nach Bestätigung und Anmeldung gilt der neue", fp, ablage.pins["brick.example.org:443"])
    }

    @Test
    fun `ein eigener Schluessel aus dem QR-Code gilt beim ersten Einrichten nur abgetippt`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm(roots = setOf(fpAlt))
        assertTrue("Eigene Wurzel: abtippen", vm.mussAbtippen("https://brick.example.org/", fp))
        assertFalse("System-Wurzel: ihre Kette muss ohnehin öffentlich gelten", vm.mussAbtippen("https://brick.example.org/", fpAlt))
        assertFalse("Ohne Fingerabdruck nichts abzutippen", vm.mussAbtippen("https://brick.example.org/", null))

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertEquals("t${R.string.setup_qr_pin_abtippen_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue("Ein Tipp genügt nicht: ${ablage.protokoll}", ablage.protokoll.isEmpty())
        assertTrue(paths.requestsAn("qr-login").isEmpty())

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "09:09:09:09:09:09:09:09:09:09:09:09")
        assertTrue("Falsch abgeschrieben: nichts", paths.requestsAn("qr-login").isEmpty())

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinSwitchInput = "07:07:07:07:07:07:07:07:07:07:07:07")
        vm.decideQrAccount(true)
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertEquals(fp, ablage.pins["brick.example.org:443"])
        assertFalse("Der bestätigte Pin gilt beim nächsten Code ohne Abtippen", vm.mussAbtippen("https://brick.example.org/", fp))
    }

    @Test
    fun `ein Token ohne Ablauf nur ueber https`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        ablage.url = "http://localhost:3000"
        vm().login("marco", "geheim")
        assertTrue("http-Anmeldung", paths.requestsAn("/auth/login").size == 1)
        assertTrue(paths.koerper.last(), paths.koerper.last().contains("\"never_expires\":false"))

        ablage.url = "https://brick.example.org"
        vm().login("marco", "geheim")
        assertTrue("https-Anmeldung", paths.requestsAn("/auth/login").size == 2)
        assertTrue(paths.koerper.last(), paths.koerper.last().contains("\"never_expires\":true"))
    }

    @Test
    fun `nach dem Abmelden ist das Formular leer`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":false,"error":"Falsches Passwort"}"""
        val vm = vm()
        vm.login("marco", "falsch")
        assertTrue("Fehler", vm.anmeldeState.value.anmeldung.errorMessage != null)
        t.sitzung.abgemeldet()
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)
    }

    @Test
    fun `eine http-Adresse wird nicht gespeichert, eine ohne Schema als https`() {
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        assertFalse(vm.saveServerUrl("http://nas:3000"))
        assertTrue(vm.saveServerUrl("brick.example.org"))
        assertTrue("abgelegt", ablage.protokoll.any { it.startsWith("url:") })
        assertEquals("Die abgelehnte Adresse meldet nicht ab und landet nirgends",
            listOf("abmelden", "url:https://brick.example.org"), ablage.protokoll.toList())
    }

    @Test
    fun `ein QR-Code mit http-Adresse wird nicht uebernommen und sagt warum`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm()
        vm.loginWithQrToken("http://nas:3000", "bim:x")
        assertEquals("t${R.string.setup_qr_klartext_abgelehnt}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue("Nichts gespeichert: ${ablage.protokoll}", ablage.protokoll.isEmpty())
        assertTrue("Der Code ging nicht hinaus", paths.requestsAn("qr-login").isEmpty())
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `ein anderer Server meldet vor der neuen Adresse ab`() {
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.saveServerUrl("https://anderer.example:8443")
        assertTrue("abgelegt", ablage.protokoll.any { it.startsWith("url:") })
        assertEquals(listOf("abmelden", "url:https://anderer.example:8443"), ablage.protokoll.take(2))
    }

    @Test
    fun `derselbe Server mit Schraegstrich meldet nicht ab`() {
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.saveServerUrl("https://SERVER/")
        assertTrue("abgelegt", ablage.protokoll.any { it.startsWith("url:") })
        assertFalse(ablage.protokoll.contains("abmelden"))
    }

    /**
     * Früher meldete der Scan den bisherigen Server sofort ab; ein abgelehnter oder
     * verfallener Code liess dann gar keine Anmeldung zurück. Jetzt koppelt die App
     * nebenher und verlässt den bisherigen Server erst nach dem Ja zum Konto.
     */
    @Test
    fun `ein QR-Code fuer einen anderen Server meldet erst nach dem Ja zum Konto ab`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = """{"success":true,"wartet":false,"token":"neu","user":{"id":2,"username":"anna"}}"""
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig")
        assertEquals("https://neu.example", vm.anmeldeState.value.qrAccount?.server)
        assertEquals("Vor dem Ja nur das Kopplungsziel", listOf("ziel:https://neu.example"), ablage.protokoll.toList())
        assertTrue(t.sitzung.state.value.isLoggedIn)

        vm.decideQrAccount(true)
        val p = ablage.protokoll.toList()
        assertEquals("Erst die Kopplung beenden, dann abmelden, dann die neue Adresse: $p",
            listOf("ziel:https://neu.example", "ziel:null", "abmelden", "url:https://neu.example"), p.take(4))
        assertTrue("Die Adresse vor dem neuen Token: $p", p.indexOf("url:https://neu.example") < p.indexOf("token:neu"))
    }

    @Test
    fun `ein Nein zum Konto eines anderen Servers laesst die bisherige Anmeldung stehen`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = previewResponse
        paths.antworten["/api/v1/auth/qr-login/verwerfen"] = """{"success":true}"""
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig")
        vm.decideQrAccount(false)
        assertEquals("Nicht abgemeldet, keine neue Adresse, kein Token",
            listOf("ziel:https://neu.example", "ziel:null"), ablage.protokoll.toList())
        assertEquals("https://server", ablage.url)
        assertTrue(t.sitzung.state.value.isLoggedIn)
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
    }

    @Test
    fun `scheitert die Kopplung mit einem anderen Server, steht der Fehler da und die Anmeldung bleibt`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":false,"error":"Code abgelaufen","code":"qr_abgelaufen"}"""
        paths.codes["/api/v1/auth/qr-login"] = 410
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig")
        assertEquals("Fehler des Servers", "Code abgelaufen", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertEquals(listOf("ziel:https://neu.example", "ziel:null"), ablage.protokoll.toList())
        assertTrue(t.sitzung.state.value.isLoggedIn)
    }

    private val previewResponse = """{"success":true,"wartet":false,"vorschau":true,"username":"marco"}"""

    @Test
    fun `eine QR-Anmeldung zeigt Konto und Server und uebernimmt den Token erst nach dem Ja`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = previewResponse
        val vm = vm()
        vm.loginWithQrToken("https://brick.example.org/", "bim:x")
        assertEquals(QrAccount("marco", "https://brick.example.org"), vm.anmeldeState.value.qrAccount)
        assertTrue("Vor dem Ja kein Token: ${ablage.protokoll}", ablage.protokoll.none { it.startsWith("token:") })
        assertFalse(t.sitzung.state.value.isLoggedIn)
        assertTrue(paths.koerper.last(), "\"vorschau\":true" in paths.koerper.last())

        paths.antworten["/api/v1/auth/qr-login/abholen"] =
            """{"success":true,"wartet":false,"token":"abc","username":"marco","user":{"id":1,"username":"marco"}}"""
        vm.decideQrAccount(true)
        assertTrue(paths.koerper.last(), "\"vorschau\":false" in paths.koerper.last())
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertTrue(ablage.protokoll.toString(), ablage.protokoll.containsAll(listOf("token:abc", "name:marco")))
        assertNull(vm.anmeldeState.value.qrAccount)
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
    }

    @Test
    fun `ein Nein zum gezeigten Konto verwirft die Kopplung und laesst nichts zurueck`() {
        paths.antworten["/api/v1/auth/qr-login"] = """{"success":true,"wartet":true,"abholung":"h","code":"123456","expires_in":300}"""
        paths.antworten["/api/v1/auth/qr-login/abholen"] = previewResponse
        paths.antworten["/api/v1/auth/qr-login/verwerfen"] = """{"success":true}"""
        val vm = vm(roots = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertEquals("marco", vm.anmeldeState.value.qrAccount?.benutzer)
        vm.decideQrAccount(false)
        assertEquals(1, paths.requestsAn("qr-login/verwerfen").size)
        assertEquals("""{"abholung":"h"}""", paths.koerper.last())
        assertEquals("Nur die Vorschau wurde abgeholt", 1, paths.requestsAn("qr-login/abholen").size)
        assertTrue("Kein Token, kein Pin: ${ablage.protokoll}",
            ablage.protokoll.none { it.startsWith("token:") || it.startsWith("pin:") })
        assertEquals("vergiss:brick.example.org:443", ablage.protokoll.last())
        assertFalse(t.sitzung.state.value.isLoggedIn)
        assertNull(vm.anmeldeState.value.qrAccount)
        assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
    }

    /** Schreibt mit, welche Optionen ankamen, und antwortet mit [ergebnis]. */
    private class FakePasskey(val ergebnis: PasskeyResult) : PasskeyQuery {
        val optionen = mutableListOf<String>()
        override suspend fun fetch(optionsJson: String): PasskeyResult { optionen += optionsJson; return ergebnis }
    }

    private val passkeyResponse = PasskeyResult.Antwort("""{"id":"pk1","response":{"clientDataJSON":"cd"}}""")
    private val optionsBody = """{"success":true,"optionen":{"challenge":"ch-123","rpId":"brick.example.org"}}"""

    @Test
    fun `mit Passkey anmelden legt den Token ab wie das Passwort`() {
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionsBody
        paths.antworten["/api/v1/auth/passkey/anmelden"] = """{"success":true,"token":"pk-token","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"voll","never_expires":true}}"""
        ablage.url = "https://brick.example.org"
        val fake = FakePasskey(passkeyResponse)
        val vm = vm()
        vm.setFullAccess(true)
        vm.signInPasskey(fake)
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        assertEquals(listOf("filter-leer", "token:pk-token", "name:marco"), ablage.protokoll)
        assertTrue(fake.optionen.single(), "\"challenge\":\"ch-123\"" in fake.optionen.single())
        val rumpf = paths.koerper[paths.requests.indexOf("POST /api/v1/auth/passkey/anmelden")]
        assertTrue(rumpf, "\"mit_token\":true" in rumpf && "\"id\":\"pk1\"" in rumpf && "\"scope\":\"voll\"" in rumpf)
        assertTrue(rumpf, "\"never_expires\":true" in rumpf)
        assertTrue(paths.koerper.first(), "\"zweck\":\"anmelden\"" in paths.koerper.first())
        assertTrue(t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `ein abgebrochener Passkey-Dialog sendet nichts und meldet keinen Fehler`() {
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionsBody
        ablage.url = "https://brick.example.org"
        val vm = vm()
        vm.signInPasskey(FakePasskey(PasskeyResult.Abgebrochen))
        assertTrue("Optionen geholt", paths.requestsAn("optionen").isNotEmpty() && !vm.anmeldeState.value.anmeldung.laeuft)
        assertNull(vm.anmeldeState.value.anmeldung.errorMessage)
        assertTrue(paths.requests.toString(), paths.requests.none { it == "POST /api/v1/auth/passkey/anmelden" })
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `ohne Passkey auf dem Geraet oder ohne Domain sagt die Anmeldung warum`() {
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionsBody
        ablage.url = "https://brick.example.org"
        val vm = vm()
        vm.signInPasskey(FakePasskey(PasskeyResult.NoPasskey))
        assertTrue("Satz", vm.anmeldeState.value.anmeldung.errorMessage != null)
        assertEquals("t${R.string.login_passkey_keiner}", vm.anmeldeState.value.anmeldung.errorMessage.text)

        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = """{"success":false,"error":"Passkeys brauchen eine Domain"}"""
        paths.codes["/api/v1/auth/passkey/anmelden/optionen"] = 503
        val fake = FakePasskey(passkeyResponse)
        vm.signInPasskey(fake)
        // Der Satz des Servers, aus der Fehlerschicht wie beim Passwort.
        assertTrue("Fehler des Servers", vm.anmeldeState.value.anmeldung.errorMessage.text == "Passkeys brauchen eine Domain")
        assertTrue("Ohne Optionen wird der Credential Manager nicht gefragt", fake.optionen.isEmpty())
    }

    @Test
    fun `der zweite Faktor nimmt den Passkey, wenn der Server ihn anbietet, mit Name und Passwort`() {
        paths.antworten["/api/v1/auth/login"] = """{"success":false,"zweiter_faktor":true,"passkey":true,"error":"Code fehlt"}"""
        paths.codes["/api/v1/auth/login"] = 401
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionsBody
        ablage.url = "https://brick.example.org"
        val vm = vm()
        vm.login("marco", "geheim")
        assertTrue("Codefeld", vm.anmeldeState.value.codeNoetig)
        assertTrue("Der Server bietet den Passkey an", vm.anmeldeState.value.passkeyStattCode)

        paths.codes.remove("/api/v1/auth/login")
        paths.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        vm.passkeyStattCode("marco", "geheim", FakePasskey(passkeyResponse))
        assertTrue("angemeldet", t.sitzung.state.value.isLoggedIn)
        val optionen = paths.koerper[paths.requests.indexOf("POST /api/v1/auth/passkey/anmelden/optionen")]
        assertTrue(optionen, "\"zweck\":\"zweiter_faktor\"" in optionen)
        val rumpf = paths.koerper[paths.requests.lastIndexOf("POST /api/v1/auth/login")]
        assertTrue(rumpf, "\"passkey\":{\"id\":\"pk1\"" in rumpf && "\"password\":\"geheim\"" in rumpf && "\"code\"" !in rumpf)
        assertFalse(vm.anmeldeState.value.passkeyStattCode)
    }

    /** Optionen mit [rpId] (null: ohne Feld) für die Adresse https://brick.example.org. */
    private fun foreignOptions(rpId: String?): FakePasskey {
        val feld = rpId?.let { ",\"rpId\":\"$it\"" } ?: ""
        paths.antworten["/api/v1/auth/passkey/anmelden/optionen"] = """{"success":true,"optionen":{"challenge":"ch-1"$feld}}"""
        ablage.url = "https://brick.example.org"
        return FakePasskey(passkeyResponse)
    }

    @Test
    fun `Optionen fuer eine fremde Domain gehen nie an den Credential Manager`() {
        for (fremd in listOf("opfer.example", "example.org", "evil.brick.example.org", "BRICK.EXAMPLE.ORG")) {
            val fake = foreignOptions(fremd)
            val vm = vm()
            vm.signInPasskey(fake)
            assertTrue("abgelehnt $fremd", vm.anmeldeState.value.anmeldung.errorMessage != null)
            assertEquals(fremd, R.string.login_passkey_rpid_fremd, (vm.anmeldeState.value.anmeldung.errorMessage as Meldung.Resource).id)
            assertTrue("$fremd erreichte den Credential Manager", fake.optionen.isEmpty())
            assertFalse(vm.anmeldeState.value.anmeldung.laeuft)
        }
        assertTrue(paths.requests.toString(), paths.requests.none { it == "POST /api/v1/auth/passkey/anmelden" })
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `Optionen ohne rpId gehen nie an den Credential Manager, auch nicht beim zweiten Faktor`() {
        val fake = foreignOptions(null)
        val vm = vm()
        vm.signInPasskey(fake)
        assertTrue("abgelehnt", vm.anmeldeState.value.anmeldung.errorMessage != null)
        assertEquals("t${R.string.login_passkey_rpid_fehlt}", vm.anmeldeState.value.anmeldung.errorMessage.text)

        val zweiter = foreignOptions("opfer.example")
        vm.passkeyStattCode("marco", "geheim", zweiter)
        assertTrue("abgelehnt", (vm.anmeldeState.value.anmeldung.errorMessage as? Meldung.Resource)?.id == R.string.login_passkey_rpid_fremd)
        assertTrue(fake.optionen.isEmpty() && zweiter.optionen.isEmpty())
        assertTrue(paths.requests.toString(), paths.requests.none { it.startsWith("POST /api/v1/auth/login") })
    }

    @Test
    fun `wechselt die Adresse waehrend des Passkey-Dialogs, geht die Antwort nirgends hin`() {
        foreignOptions("brick.example.org")
        val switch = PasskeyQuery { ablage.url = "https://anders.example"; passkeyResponse }
        val vm = vm()
        vm.signInPasskey(switch)
        assertTrue("abgelehnt", vm.anmeldeState.value.anmeldung.errorMessage != null)
        assertEquals("t${R.string.login_passkey_fehler}", vm.anmeldeState.value.anmeldung.errorMessage.text)
        assertTrue(paths.requests.toString(), paths.requests.none { it == "POST /api/v1/auth/passkey/anmelden" })
    }
}
