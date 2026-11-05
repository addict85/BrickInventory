package ch.brickinventoryapp

import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.PasskeyAbfrage
import ch.brickinventoryapp.ui.PasskeyErgebnis
import ch.brickinventoryapp.ui.viewmodel.AnmeldungViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.ui.Blickfeld
import ch.brickinventoryapp.ui.FilterAblage
import ch.brickinventoryapp.ui.viewmodel.AppDienste

/**
 * Das Anmelde-ViewModel, ausgeführt gegen einen Testserver und eine Ablage im
 * Speicher.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen AnmeldungViewModel.kt):
 *   A  in angemeldet() anmeldungBeginnt() NACH dem Token → rot „eine Anmeldung
 *      leert die Filter, legt den Token ab …“ (die Reihenfolge wird mitgeschrieben)
 *   B  beim zweiten Faktor den Fehler auch ohne Code gezeigt → rot „beim ersten
 *      Mal fragt der zweite Faktor nur nach dem Code“
 *   C  in qrGescheitert() den Satz immer gesetzt → rot „ein zweiter QR-Anlauf
 *      nach gelungener Anmeldung meldet keinen Fehler“
 *   D  zuruecksetzen() leer → rot „nach dem Abmelden ist das Formular leer“
 *   E  in richteEin() den Aufruf abmelden() entfernt → rot „ein anderer Server
 *      meldet vor der neuen Adresse ab“ und „ein QR-Code für einen anderen
 *      Server meldet zuerst ab“
 *   F  gleicheHerkunft() durch `!=` der rohen Texte ersetzt → rot „derselbe
 *      Server mit Schrägstrich meldet nicht ab“
 *   G  (01.11.2026) in saveServerUrl() die Prüfung adressfehler() entfernt → rot
 *      „eine http-Adresse wird nicht gespeichert“
 *   H  (01.11.2026) in loginWithQrToken() die Prüfung entfernt → rot „ein
 *      QR-Code mit http-Adresse …“ (Adresse gespeichert, qr-login gerufen)
 *   I  (30.10.2026) merkePin() in loginWithQrToken() nach qrLogin() → rot „ein
 *      QR-Code mit Fingerabdruck pinnt vor der ersten Anfrage“ (Test seit O–Q
 *      umgeschrieben: vorgehalten statt gemerkt)
 *   O  in loginWithQrToken() wieder merkePin() statt halteVor() vor qrLogin() →
 *      rot „ein gescheiterter QR-Code hinterlaesst keinen Pin“ und „… haelt den
 *      Pin … vor“
 *   P  die Prüfung bisherigerPin() vor dem Start entfernt → rot „ein QR-Code
 *      mit anderem Schluessel ersetzt den Pin nie still“
 *   R  (01.11.2026) die Prüfung bestaetigtFingerabdruck() in loginWithQrToken()
 *      durch `pinWechselEingabe == null` ersetzt (jede Eingabe genügt) → rot
 *      „ein QR-Code mit anderem Schluessel ersetzt den Pin nie still“ (falsch
 *      abgeschriebener Wert angenommen)
 *   Q  das finally mit vergissVorgehaltenen() entfernt → rot „ein gescheiterter
 *      QR-Code hinterlaesst keinen Pin“ (Zeitüberschreitung, nichts vergessen)
 *   J  (30.10.2026) LoginRequest wieder mit festem neverExpires = true → rot
 *      „ein Token ohne Ablauf nur ueber https“ (http-Teil)
 *   K  (31.10.2026) PasskeyAnmeldung mit mitToken = false → rot „mit Passkey
 *      anmelden legt den Token ab …“
 *   L  (31.10.2026) Abgebrochen wie KeinPasskey mit Satz → rot „ein
 *      abgebrochener Passkey-Dialog …“
 *   M  (31.10.2026) ZweiterFaktorWege im KontoRepository nicht gelesen → rot
 *      „der zweite Faktor nimmt den Passkey …“ (Knopf fehlt)
 *   N  (31.10.2026) passkeyStattCode() reicht den Passkey nicht an login() →
 *      rot „der zweite Faktor nimmt den Passkey …“ (kein passkey im Rumpf)
 *   S  (02.11.2026) in holePasskey() RpIdBefund.FREMD durchgelassen → rot
 *      „Optionen fuer eine fremde Domain …“ und „Optionen ohne rpId … zweiten Faktor“
 *   T  RpIdBefund.FEHLT durchgelassen → rot „Optionen ohne rpId …“
 *   U  pruefeRpId() mit ignoreCase und Unterdomänen (`host.endsWith("." + rpId)`)
 *      → rot „Optionen fuer eine fremde Domain …“
 *   V  die Prüfung der Adresse nach dem Dialog entfernt → rot „wechselt die
 *      Adresse waehrend des Passkey-Dialogs …“
 *   W  FINGERABDRUCK_ABTIPPEN = 16 → rot „ein QR-Code mit anderem Schluessel
 *      ersetzt den Pin nie still“ (16 Zeichen angenommen)
 *   X  (sec10 N2) mussAbtippen() ohne Pin wieder `false` (Stand davor: ein Tipp
 *      genügte beim ersten Einrichten) → rot „ein eigener Schluessel aus dem
 *      QR-Code gilt beim ersten Einrichten nur abgetippt“;
 *      gegenproben/qr-pin-ohne-abtippen.patch
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnmeldungViewModelTest {

    /** Schreibt mit, was in welcher Reihenfolge abgelegt wird. */
    private class Ablage(var url: String = "https://server") : Anmeldeablage {
        val protokoll = java.util.Collections.synchronizedList(mutableListOf<String>())
        override suspend fun serverUrlJetzt() = url
        override suspend fun saveServerUrl(url: String) { this.url = url; protokoll += "url:$url" }
        override suspend fun saveAuthToken(token: String) { protokoll += "token:$token" }
        override suspend fun saveUsername(name: String) { protokoll += "name:$name" }
        val pins = java.util.concurrent.ConcurrentHashMap<String, String>()
        override fun merkePin(schluessel: String, fingerabdruck: String) {
            pins[schluessel] = fingerabdruck; protokoll += "pin:$schluessel=$fingerabdruck"
        }
        override fun gemerkterPin(schluessel: String): String? = pins[schluessel]
        override fun halteVor(schluessel: String, fingerabdruck: String) { protokoll += "vor:$schluessel=$fingerabdruck" }
        override fun vergissVorgehaltenen(schluessel: String) { protokoll += "vergiss:$schluessel" }
    }

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste
    private lateinit var ablage: Ablage

    /** Die Filterablage meldet ihr Leeren in dasselbe Protokoll; [wurzeln] spielt die System-Wurzeln. */
    private fun vm(wurzeln: Set<String> = emptySet()): AnmeldungViewModel {
        val blickAblage = object : FilterAblage by SpeicherAblage() {
            override suspend fun allesVergessen() { ablage.protokoll += "filter-leer" }
        }
        val blickfeld = Blickfeld(blickAblage,
            HaushaltRepository(t.api, t.cache),
            TeileRepository(t.api, t.cache))
        val dienste = AppDienste(t.sitzung, blickfeld, t.meldungen,
            NummernTexte, t.bestand, t.scrollMemory)
        return t.merke(AnmeldungViewModel(dienste, KontoRepository(t.api, t.cache), ablage) { it in wurzeln })
    }

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        pfade = PfadServer()
        t = TestDienste(pfade.server)
        ablage = Ablage()
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `eine Anmeldung leert die Filter, legt den Token ab und meldet die Sitzung`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"voll","never_expires":false}}"""
        val vm = vm()
        vm.setzeVollerZugriff(true)
        vm.login("marco", "geheim")
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        assertEquals(listOf("filter-leer", "token:abc", "name:marco"), ablage.protokoll)
        assertTrue(pfade.koerper.single(), "\"scope\":\"voll\"" in pfade.koerper.single())
        assertTrue(t.sitzung.state.value.isAdmin)
        assertFalse(vm.anmeldeState.value.loginLaeuft)
    }

    /**
     * Ohne das Häkchen ein Token mit Scope "app": Das Kontorecht allein macht in
     * der App keinen Verwalter, der Server wiese dessen Aufrufe mit 403 ab.
     * Gegenprobe (30.10.2026, gemessen): in AnmeldungViewModel `r.data.verwalter`
     * → `r.data.user?.isAdmin == true` → rot „Verwalterkonto ohne Häkchen …“.
     */
    @Test
    fun `Verwalterkonto ohne Häkchen meldet sich ohne Verwalterrechte an`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"app","never_expires":false}}"""
        val vm = vm()
        vm.login("marco", "geheim")
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        assertTrue(pfade.koerper.single(), "\"scope\":\"app\"" in pfade.koerper.single())
        assertFalse(t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `beim ersten Mal fragt der zweite Faktor nur nach dem Code`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":false,"zweiter_faktor":true,"error":"Code fehlt"}"""
        pfade.codes["/api/v1/auth/login"] = 401
        val vm = vm()
        vm.login("marco", "geheim")
        TestApi.warteBis("Codefeld") { vm.anmeldeState.value.codeNoetig }
        assertNull("Ohne eingegebenen Code ist das kein Fehler", vm.anmeldeState.value.loginError)
        assertFalse("Ohne `passkey: true` kein Passkey-Knopf", vm.anmeldeState.value.passkeyStattCode)

        vm.login("marco", "geheim", code = "123456")
        TestApi.warteBis("Satz des Servers") { vm.anmeldeState.value.loginError != null }
        assertEquals("Code fehlt", vm.anmeldeState.value.loginError)
        assertTrue(ablage.protokoll.none { it.startsWith("token:") })
    }

    @Test
    fun `ein zweiter QR-Anlauf nach gelungener Anmeldung meldet keinen Fehler`() {
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":false,"error":"Ungültiges oder abgelaufenes Token"}"""
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://server/", "einmalig", abmelden = { ablage.protokoll += "abmelden" })
        TestApi.warteBis("Antwort") { pfade.anfragenAn("qr-login").isNotEmpty() && !vm.anmeldeState.value.loginLaeuft }
        assertNull(vm.anmeldeState.value.loginError)
        assertEquals("Derselbe Server: keine Abmeldung", "url:https://server", ablage.protokoll.first())
    }

    private val fp = java.util.Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
    private val fpAlt = java.util.Base64.getEncoder().encodeToString(ByteArray(32) { 9 })

    @Test
    fun `ein QR-Code mit Fingerabdruck haelt den Pin fuer die erste Anfrage vor und merkt ihn erst danach`() {
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm(wurzeln = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn && ablage.protokoll.any { it.startsWith("vergiss:") } }
        val p = ablage.protokoll.toList()
        assertEquals("vor:brick.example.org:443=$fp", p.first())
        assertTrue("Gemerkt nach der Adresse, vor dem Token: $p",
            p.indexOf("url:https://brick.example.org") < p.indexOf("pin:brick.example.org:443=$fp") &&
                p.indexOf("pin:brick.example.org:443=$fp") < p.indexOf("token:abc"))
        assertEquals(fp, ablage.pins["brick.example.org:443"])
    }

    @Test
    fun `ein gescheiterter QR-Code hinterlaesst keinen Pin`() {
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":false,"error":"Ungültiges oder abgelaufenes Token"}"""
        val vm = vm(wurzeln = setOf(fp))
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        TestApi.warteBis("Antwort") { ablage.protokoll.any { it.startsWith("vergiss:") } }
        assertTrue(pfade.anfragenAn("qr-login").isNotEmpty())
        assertTrue("Nichts dauerhaft: ${ablage.protokoll}", ablage.pins.isEmpty())
        assertEquals("vergiss:brick.example.org:443", ablage.protokoll.last())
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `ein QR-Code mit anderem Schluessel ersetzt den Pin nie still`() {
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        ablage.pins["brick.example.org:443"] = fpAlt
        val vm = vm()
        assertEquals("Der Bildschirm bekommt den bisherigen", fpAlt, vm.bisherigerPin("brick.example.org", fp))
        assertNull("Derselbe ist kein Wechsel", vm.bisherigerPin("https://brick.example.org/", fpAlt))

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertEquals("t${R.string.setup_qr_pin_wechsel_abgelehnt}", vm.anmeldeState.value.loginError)
        Thread.sleep(100)
        assertTrue("Ohne Bestätigung nichts: ${ablage.protokoll}", ablage.protokoll.isEmpty())
        assertTrue(pfade.anfragenAn("qr-login").isEmpty())
        assertEquals(fpAlt, ablage.pins["brick.example.org:443"])

        // Ein Tipp mit falsch abgeschriebenem Wert genügt ebenso wenig.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinWechselEingabe = "09:09:09:09:09:09:09:09:09:09:09:09")
        assertEquals("t${R.string.setup_qr_pin_wechsel_abgelehnt}", vm.anmeldeState.value.loginError)
        Thread.sleep(100)
        assertTrue("Falsch abgeschrieben: nichts", pfade.anfragenAn("qr-login").isEmpty())

        // 16 Zeichen (64 Bit) genügen nicht mehr.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinWechselEingabe = "07:07:07:07:07:07:07:07")
        assertEquals("t${R.string.setup_qr_pin_wechsel_abgelehnt}", vm.anmeldeState.value.loginError)

        // Die letzten 24 Hex-Zeichen des neuen Fingerabdrucks, wie aus der Webapp abgeschrieben.
        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinWechselEingabe = "07:07:07:07:07:07:07:07:07:07:07:07")
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        assertEquals("Nach Bestätigung und Anmeldung gilt der neue", fp, ablage.pins["brick.example.org:443"])
    }

    @Test
    fun `ein eigener Schluessel aus dem QR-Code gilt beim ersten Einrichten nur abgetippt`() {
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm(wurzeln = setOf(fpAlt))
        assertTrue("Eigene Wurzel: abtippen", vm.mussAbtippen("https://brick.example.org/", fp))
        assertFalse("System-Wurzel: ihre Kette muss ohnehin öffentlich gelten", vm.mussAbtippen("https://brick.example.org/", fpAlt))
        assertFalse("Ohne Fingerabdruck nichts abzutippen", vm.mussAbtippen("https://brick.example.org/", null))

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp)
        assertEquals("t${R.string.setup_qr_pin_abtippen_abgelehnt}", vm.anmeldeState.value.loginError)
        Thread.sleep(100)
        assertTrue("Ein Tipp genügt nicht: ${ablage.protokoll}", ablage.protokoll.isEmpty())
        assertTrue(pfade.anfragenAn("qr-login").isEmpty())

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinWechselEingabe = "09:09:09:09:09:09:09:09:09:09:09:09")
        Thread.sleep(100)
        assertTrue("Falsch abgeschrieben: nichts", pfade.anfragenAn("qr-login").isEmpty())

        vm.loginWithQrToken("https://brick.example.org/", "bim:x", fingerabdruck = fp,
            pinWechselEingabe = "07:07:07:07:07:07:07:07:07:07:07:07")
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        assertEquals(fp, ablage.pins["brick.example.org:443"])
        assertFalse("Der bestätigte Pin gilt beim nächsten Code ohne Abtippen", vm.mussAbtippen("https://brick.example.org/", fp))
    }

    @Test
    fun `ein Token ohne Ablauf nur ueber https`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        ablage.url = "http://localhost:3000"
        vm().login("marco", "geheim")
        TestApi.warteBis("http-Anmeldung") { pfade.anfragenAn("/auth/login").size == 1 }
        assertTrue(pfade.koerper.last(), pfade.koerper.last().contains("\"never_expires\":false"))

        ablage.url = "https://brick.example.org"
        vm().login("marco", "geheim")
        TestApi.warteBis("https-Anmeldung") { pfade.anfragenAn("/auth/login").size == 2 }
        assertTrue(pfade.koerper.last(), pfade.koerper.last().contains("\"never_expires\":true"))
    }

    @Test
    fun `nach dem Abmelden ist das Formular leer`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":false,"error":"Falsches Passwort"}"""
        val vm = vm()
        vm.login("marco", "falsch")
        TestApi.warteBis("Fehler") { vm.anmeldeState.value.loginError != null }
        t.sitzung.abgemeldet()
        assertNull(vm.anmeldeState.value.loginError)
    }

    @Test
    fun `eine http-Adresse wird nicht gespeichert, eine ohne Schema als https`() {
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        assertFalse(vm.saveServerUrl("http://nas:3000", abmelden = { ablage.protokoll += "abmelden" }))
        assertTrue(vm.saveServerUrl("brick.example.org", abmelden = { ablage.protokoll += "abmelden" }))
        TestApi.warteBis("abgelegt") { ablage.protokoll.any { it.startsWith("url:") } }
        assertEquals("Die abgelehnte Adresse meldet nicht ab und landet nirgends",
            listOf("abmelden", "url:https://brick.example.org"), ablage.protokoll.toList())
    }

    @Test
    fun `ein QR-Code mit http-Adresse wird nicht uebernommen und sagt warum`() {
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        val vm = vm()
        vm.loginWithQrToken("http://nas:3000", "bim:x")
        assertEquals("t${R.string.setup_qr_klartext_abgelehnt}", vm.anmeldeState.value.loginError)
        Thread.sleep(100)
        assertTrue("Nichts gespeichert: ${ablage.protokoll}", ablage.protokoll.isEmpty())
        assertTrue("Der Code ging nicht hinaus", pfade.anfragenAn("qr-login").isEmpty())
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `ein anderer Server meldet vor der neuen Adresse ab`() {
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.saveServerUrl("https://anderer.example:8443", abmelden = { ablage.protokoll += "abmelden" })
        TestApi.warteBis("abgelegt") { ablage.protokoll.any { it.startsWith("url:") } }
        assertEquals(listOf("abmelden", "url:https://anderer.example:8443"), ablage.protokoll.take(2))
    }

    @Test
    fun `derselbe Server mit Schraegstrich meldet nicht ab`() {
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.saveServerUrl("https://SERVER/", abmelden = { ablage.protokoll += "abmelden" })
        TestApi.warteBis("abgelegt") { ablage.protokoll.any { it.startsWith("url:") } }
        assertFalse(ablage.protokoll.contains("abmelden"))
    }

    @Test
    fun `ein QR-Code fuer einen anderen Server meldet zuerst ab`() {
        pfade.antworten["/api/v1/auth/qr-login"] = """{"success":true,"token":"neu","user":{"id":2,"username":"anna"}}"""
        t.sitzung.angemeldet(admin = false)
        val vm = vm()
        vm.loginWithQrToken("https://neu.example", "einmalig", abmelden = { ablage.protokoll += "abmelden" })
        TestApi.warteBis("angemeldet") { ablage.protokoll.contains("token:neu") }
        val p = ablage.protokoll.toList()
        assertTrue("Abmelden vor der Adresse: $p", p.indexOf("abmelden") in 0 until p.indexOf("url:https://neu.example"))
        assertTrue("Die Adresse vor dem neuen Token: $p", p.indexOf("url:https://neu.example") < p.indexOf("token:neu"))
    }

    /** Schreibt mit, welche Optionen ankamen, und antwortet mit [ergebnis]. */
    private class FakePasskey(val ergebnis: PasskeyErgebnis) : PasskeyAbfrage {
        val optionen = mutableListOf<String>()
        override suspend fun hole(optionenJson: String): PasskeyErgebnis { optionen += optionenJson; return ergebnis }
    }

    private val passkeyAntwort = PasskeyErgebnis.Antwort("""{"id":"pk1","response":{"clientDataJSON":"cd"}}""")
    private val optionenRumpf = """{"success":true,"optionen":{"challenge":"ch-123","rpId":"brick.example.org"}}"""

    @Test
    fun `mit Passkey anmelden legt den Token ab wie das Passwort`() {
        pfade.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionenRumpf
        pfade.antworten["/api/v1/auth/passkey/anmelden"] = """{"success":true,"token":"pk-token","user":{"id":1,"username":"marco","is_admin":true},
            "token_info":{"scope":"voll","never_expires":true}}"""
        ablage.url = "https://brick.example.org"
        val fake = FakePasskey(passkeyAntwort)
        val vm = vm()
        vm.setzeVollerZugriff(true)
        vm.passkeyAnmelden(fake)
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        assertEquals(listOf("filter-leer", "token:pk-token", "name:marco"), ablage.protokoll)
        assertTrue(fake.optionen.single(), "\"challenge\":\"ch-123\"" in fake.optionen.single())
        val rumpf = pfade.koerper[pfade.anfragen.indexOf("POST /api/v1/auth/passkey/anmelden")]
        assertTrue(rumpf, "\"mit_token\":true" in rumpf && "\"id\":\"pk1\"" in rumpf && "\"scope\":\"voll\"" in rumpf)
        assertTrue(rumpf, "\"never_expires\":true" in rumpf)
        assertTrue(pfade.koerper.first(), "\"zweck\":\"anmelden\"" in pfade.koerper.first())
        assertTrue(t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `ein abgebrochener Passkey-Dialog sendet nichts und meldet keinen Fehler`() {
        pfade.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionenRumpf
        ablage.url = "https://brick.example.org"
        val vm = vm()
        vm.passkeyAnmelden(FakePasskey(PasskeyErgebnis.Abgebrochen))
        TestApi.warteBis("Optionen geholt") { pfade.anfragenAn("optionen").isNotEmpty() && !vm.anmeldeState.value.loginLaeuft }
        assertNull(vm.anmeldeState.value.loginError)
        assertTrue(pfade.anfragen.toString(), pfade.anfragen.none { it == "POST /api/v1/auth/passkey/anmelden" })
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `ohne Passkey auf dem Geraet oder ohne Domain sagt die Anmeldung warum`() {
        pfade.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionenRumpf
        ablage.url = "https://brick.example.org"
        val vm = vm()
        vm.passkeyAnmelden(FakePasskey(PasskeyErgebnis.KeinPasskey))
        TestApi.warteBis("Satz") { vm.anmeldeState.value.loginError != null }
        assertEquals("t${R.string.login_passkey_keiner}", vm.anmeldeState.value.loginError)

        pfade.antworten["/api/v1/auth/passkey/anmelden/optionen"] = """{"success":false,"error":"Passkeys brauchen eine Domain"}"""
        pfade.codes["/api/v1/auth/passkey/anmelden/optionen"] = 503
        val fake = FakePasskey(passkeyAntwort)
        vm.passkeyAnmelden(fake)
        // NummernTexte.meldung() gibt „fehler“: Der Satz kommt aus der Fehlerschicht wie beim Passwort.
        TestApi.warteBis("Fehler des Servers") { vm.anmeldeState.value.loginError == "fehler" }
        assertTrue("Ohne Optionen wird der Credential Manager nicht gefragt", fake.optionen.isEmpty())
    }

    @Test
    fun `der zweite Faktor nimmt den Passkey, wenn der Server ihn anbietet, mit Name und Passwort`() {
        pfade.antworten["/api/v1/auth/login"] = """{"success":false,"zweiter_faktor":true,"passkey":true,"error":"Code fehlt"}"""
        pfade.codes["/api/v1/auth/login"] = 401
        pfade.antworten["/api/v1/auth/passkey/anmelden/optionen"] = optionenRumpf
        ablage.url = "https://brick.example.org"
        val vm = vm()
        vm.login("marco", "geheim")
        TestApi.warteBis("Codefeld") { vm.anmeldeState.value.codeNoetig }
        assertTrue("Der Server bietet den Passkey an", vm.anmeldeState.value.passkeyStattCode)

        pfade.codes.remove("/api/v1/auth/login")
        pfade.antworten["/api/v1/auth/login"] = """{"success":true,"token":"abc","user":{"id":1,"username":"marco"}}"""
        vm.passkeyStattCode("marco", "geheim", FakePasskey(passkeyAntwort))
        TestApi.warteBis("angemeldet") { t.sitzung.state.value.isLoggedIn }
        val optionen = pfade.koerper[pfade.anfragen.indexOf("POST /api/v1/auth/passkey/anmelden/optionen")]
        assertTrue(optionen, "\"zweck\":\"zweiter_faktor\"" in optionen)
        val rumpf = pfade.koerper[pfade.anfragen.lastIndexOf("POST /api/v1/auth/login")]
        assertTrue(rumpf, "\"passkey\":{\"id\":\"pk1\"" in rumpf && "\"password\":\"geheim\"" in rumpf && "\"code\"" !in rumpf)
        assertFalse(vm.anmeldeState.value.passkeyStattCode)
    }

    /** Optionen mit [rpId] (null: ohne Feld) für die Adresse https://brick.example.org. */
    private fun fremdeOptionen(rpId: String?): FakePasskey {
        val feld = rpId?.let { ",\"rpId\":\"$it\"" } ?: ""
        pfade.antworten["/api/v1/auth/passkey/anmelden/optionen"] = """{"success":true,"optionen":{"challenge":"ch-1"$feld}}"""
        ablage.url = "https://brick.example.org"
        return FakePasskey(passkeyAntwort)
    }

    @Test
    fun `Optionen fuer eine fremde Domain gehen nie an den Credential Manager`() {
        for (fremd in listOf("opfer.example", "example.org", "evil.brick.example.org", "BRICK.EXAMPLE.ORG")) {
            val fake = fremdeOptionen(fremd)
            val vm = vm()
            vm.passkeyAnmelden(fake)
            TestApi.warteBis("abgelehnt $fremd") { vm.anmeldeState.value.loginError != null }
            assertEquals(fremd, "t${R.string.login_passkey_rpid_fremd}", vm.anmeldeState.value.loginError)
            assertTrue("$fremd erreichte den Credential Manager", fake.optionen.isEmpty())
            assertFalse(vm.anmeldeState.value.loginLaeuft)
        }
        assertTrue(pfade.anfragen.toString(), pfade.anfragen.none { it == "POST /api/v1/auth/passkey/anmelden" })
        assertFalse(t.sitzung.state.value.isLoggedIn)
    }

    @Test
    fun `Optionen ohne rpId gehen nie an den Credential Manager, auch nicht beim zweiten Faktor`() {
        val fake = fremdeOptionen(null)
        val vm = vm()
        vm.passkeyAnmelden(fake)
        TestApi.warteBis("abgelehnt") { vm.anmeldeState.value.loginError != null }
        assertEquals("t${R.string.login_passkey_rpid_fehlt}", vm.anmeldeState.value.loginError)

        val zweiter = fremdeOptionen("opfer.example")
        vm.passkeyStattCode("marco", "geheim", zweiter)
        TestApi.warteBis("abgelehnt") { vm.anmeldeState.value.loginError == "t${R.string.login_passkey_rpid_fremd}" }
        assertTrue(fake.optionen.isEmpty() && zweiter.optionen.isEmpty())
        assertTrue(pfade.anfragen.toString(), pfade.anfragen.none { it.startsWith("POST /api/v1/auth/login") })
    }

    @Test
    fun `wechselt die Adresse waehrend des Passkey-Dialogs, geht die Antwort nirgends hin`() {
        fremdeOptionen("brick.example.org")
        val wechsel = PasskeyAbfrage { ablage.url = "https://anders.example"; passkeyAntwort }
        val vm = vm()
        vm.passkeyAnmelden(wechsel)
        TestApi.warteBis("abgelehnt") { vm.anmeldeState.value.loginError != null }
        assertEquals("t${R.string.login_passkey_fehler}", vm.anmeldeState.value.loginError)
        assertTrue(pfade.anfragen.toString(), pfade.anfragen.none { it == "POST /api/v1/auth/passkey/anmelden" })
    }
}
