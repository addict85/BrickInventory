package ch.brickinventoryapp.account

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.testing.RowsServer
import ch.brickinventoryapp.testing.SessionFake
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt

/**
 * Das Konto-ViewModel, ausgeführt gegen einen Testserver.
 *
 * Gegenproben:
 *  - In redeemQuestion() die Prüfung `liste.none { it.aktuell }`
 *    entfernt: „ohne erkanntes eigenes Gerät wird nichts entwertet" rot — die
 *    Rückfrage ging auf.
 *  - In redeemConfirm() `codeNoetig` nicht gesetzt: „ein fremdes Gerät
 *    verlangt Passwort und bei Bedarf den Code" rot; das Passwort nicht in den
 *    Rumpf gelegt: dieselbe Prüfung rot (kein "password").
 *  - In aenderePasswort() den Aufruf `sessionService.abmelden()` entfernt: „nach dem
 *    Passwortwechsel wird abgemeldet" rot.
 *  - In zweiterFaktor() `successText` nicht mehr gemeldet: „der bestätigte
 *    zweite Faktor zeigt die Codes" rot an der Meldung.
 *  - In asDevice() `.minOrNull()` → `.maxOrNull()`: „die
 *    Geräteliste zeigt Vollzugriff und die frühere Frist" rot (2027 statt 2026);
 *    `zugaenge` beim Zählen nicht beachtet: „ein schon entwertetes Gerät zählt
 *    nicht“ rot.
 *  - In abgelehnt() `codeNoetig` nicht gesetzt: „ohne Code
 *    verlangt der zweite Faktor …“ und „eine neue E-Mail …“ rot; in aenderePasswort()
 *    den Code nicht an changePassword() gereicht: dieselbe Prüfung rot (kein
 *    "code" im Rumpf).
 *  - In setUpSecondFactorOne() `d.otpauth` ungeprüft übernommen:
 *    „a foreign address instead of otpauth is not opened“ rot.
 *  - Patch gegenproben/profil-ohne-passwort.patch (die Prüfung
 *    `passwort.isNullOrBlank()` in saveProfile() entfernt): „ohne Passwort
 *    fragt das Profil den Server nicht“ rot.
 *  - Patch gegenproben/profil-mail-nicht-gesendet-still.patch (`emailSent` nicht
 *    ausgewertet): „eine neue E-Mail ohne gesendete Mail …“ rot. Patch
 *    gegenproben/profil-neu-laden-loescht-fehler.patch (fetchProfile() nimmt den
 *    Fehler mit withoutError() weg): dieselbe Prüfung rot an „übersteht das Neuladen“.
 *  - Patch gegenproben/konto-laedt-nicht-beim-beobachten.patch (observeLoadOn für
 *    Geräte und zweiten Faktor gestrichen): „Geräte und zweiter Faktor laden, sobald …“ rot.
 *  - Patch gegenproben/kontoseite-laedt-nicht.patch (observeLoadOn der Kontoseite
 *    gestrichen): „Profil und Design laden mit der Kontoseite …“ rot.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTest {

    private val clock = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(clock)
    private lateinit var server: RowsServer
    private lateinit var cacheDir: File
    private lateinit var kanal: MeldungsKanal
    private lateinit var vm: AccountViewModel

    @Volatile private var abgemeldet = false

    private fun antwort(rumpf: String, code: Int = 200) = TestApi.antwort(rumpf, code)

    /** Im Takt ist ein Zustand da, sobald die anstehenden Schritte gelaufen sind, oder nie. */
    private fun bis(was: String, bedingung: () -> Boolean) {
        clock.runCurrent()
        assertTrue(was, bedingung())
    }

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        server = RowsServer()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-konto-${System.nanoTime()}")
        cacheDir.mkdirs()
        kanal = MeldungsKanal()
        vm = AccountViewModel(testAccountRepository(server.api, takt), kanal,
                            Sitzung(), SessionFake { abgemeldet = true })
    }

    @After
    fun zu() {
        server.shutdown()
        server.pruefeEinlesen()
        cacheDir.deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `devices and second factor load as soon as someone observes their state`() {
        clock.runCurrent()
        assertEquals("ohne Beobachter kein Abruf", 0, server.requestCount)
        server.enqueue(antwort(geraete(currentAlong = true)))
        val devicesPage = CoroutineScope(takt).launch { vm.geraeteState.collect {} }
        bis("Geräte") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.abruf.laedt }
        server.enqueue(antwort("""{"success":true,"aktiv":true,"codes_uebrig":8}"""))
        val factorPage = CoroutineScope(takt).launch { vm.secondFactorState.collect {} }
        bis("zweiter Faktor") { vm.secondFactorState.value.aktiv == true && vm.secondFactorState.value.codesUebrig == 8 }
        devicesPage.cancel()
        factorPage.cancel()
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `profile and design load with the account page, not with the start password form`() {
        val mask = CoroutineScope(takt).launch { vm.kontoState.collect {} }
        clock.runCurrent()
        assertEquals("die Maske lädt nichts", 0, server.requestCount)
        server.enqueue(antwort("""{"success":false,"error":"aus"}""", 500))
        server.enqueue(antwort("""{"success":false,"error":"aus"}""", 500))
        val seite = CoroutineScope(takt).launch { vm.accountPage.collect {} }
        bis("Profil und Design geholt") { server.requestCount == 2 }
        mask.cancel()
        seite.cancel()
    }

    private fun geraete(currentAlong: Boolean) = """{"success":true,"tokens":[
        {"token_id":"a1","label":"Telefon","aktuell":$currentAlong},
        {"token_id":"b2","label":"Tablet"},
        {"token_id":"c3","label":"Alt"}]}"""

    @Test
    fun `other devices go in one confirmed request, the own one stays`() {
        server.enqueue(antwort(geraete(currentAlong = true)))
        vm.loadDevices()
        bis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.abruf.laedt }
        server.takeRequest()

        vm.redeemQuestion(null)
        bis("Rückfrage") { vm.geraeteState.value.prompt?.tokenId == null && vm.geraeteState.value.prompt != null }
        server.enqueue(antwort("""{"success":true,"deleted":0,"zugaenge":2}"""))
        server.enqueue(antwort(geraete(currentAlong = true)))
        vm.redeemConfirm("geheim", null)
        bis("neu geladen") { server.requestCount == 3 && !vm.geraeteState.value.abruf.laedt }

        val r = server.takeRequest()
        assertTrue(r.path.orEmpty(), r.path.orEmpty().endsWith("/settings/sessions/andere-beenden"))
        val rumpf = r.body.readUtf8()
        assertTrue(rumpf, rumpf.contains("\"password\":\"geheim\"") && rumpf.contains("\"zugaenge\":true"))
        assertNull(vm.geraeteState.value.prompt)
        assertEquals("m${R.plurals.tokens_revoked_n}:2", kanal.text)
    }

    @Test
    fun `a foreign device requires password and, if needed, the code`() {
        server.enqueue(antwort(geraete(currentAlong = true)))
        vm.loadDevices()
        bis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.abruf.laedt }
        server.takeRequest()

        vm.redeemQuestion("b2")
        server.enqueue(antwort("""{"success":false,"error":"Code fehlt","code":"zweiter_faktor_noetig"}""", 400))
        vm.redeemConfirm("geheim", null)
        bis("Code verlangt") { vm.geraeteState.value.prompt?.codeNoetig == true }
        val ohne = server.takeRequest()
        assertEquals("DELETE", ohne.method)
        assertTrue(ohne.path.orEmpty(), ohne.path.orEmpty().endsWith("/settings/tokens/b2"))
        assertTrue(ohne.body.readUtf8().contains("\"password\":\"geheim\""))

        server.enqueue(antwort("""{"success":true,"deleted":1}"""))
        server.enqueue(antwort(geraete(currentAlong = true)))
        vm.redeemConfirm("geheim", "123456")
        bis("erledigt") { server.requestCount == 4 && vm.geraeteState.value.prompt == null }
        assertTrue(server.takeRequest().body.readUtf8().contains("\"code\":\"123456\""))
        assertEquals("t${R.string.tokens_revoked}", kanal.text)
    }

    @Test
    fun `the device list shows full access and the earlier deadline`() {
        server.enqueue(antwort("""{"success":true,"tokens":[
            {"token_prefix":"abcd1234","token_id":"abcd1234abcd1234","label":"Rechner","created_at":"2026-01-01T00:00:00Z",
             "last_used":null,"expires_at":"2027-03-01T00:00:00Z","hard_expires_at":"2026-12-01T00:00:00Z",
             "never_expires":false,"scope":"voll","ip_range":"192.168.1.0/24","rotated_at":"2026-09-01T00:00:00Z","aktuell":false},
            {"token_prefix":"ffff0000","token_id":"ffff0000ffff0000","label":"","created_at":"2026-01-01T00:00:00Z",
             "last_used":null,"expires_at":null,"hard_expires_at":null,"never_expires":true,"scope":"app",
             "ip_range":null,"rotated_at":"2026-10-01T00:00:00Z","aktuell":true}]}"""))
        vm.loadDevices()
        bis("Liste") { vm.geraeteState.value.geraete.size == 2 }
        val (voll, own) = vm.geraeteState.value.geraete
        assertTrue(voll.vollerZugriff)
        assertEquals("2026-12-01T00:00:00Z", voll.runningAb)
        assertEquals("192.168.1.0/24", voll.ipArea)
        assertFalse(own.vollerZugriff)
        assertEquals("unbegrenzt", null, own.runningAb)
        assertEquals("—", own.bezeichnung)
    }

    @Test
    fun `an already invalidated device does not count`() {
        server.enqueue(antwort(geraete(currentAlong = true)))
        vm.loadDevices()
        bis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.abruf.laedt }
        vm.redeemQuestion(null)
        server.enqueue(antwort("""{"success":true,"deleted":1,"zugaenge":0}"""))
        server.enqueue(antwort(geraete(currentAlong = true)))
        vm.redeemConfirm("geheim", null)
        bis("neu geladen") { server.requestCount == 3 && !vm.geraeteState.value.abruf.laedt }
        assertEquals("m${R.plurals.tokens_revoked_n}:0", kanal.text)
    }

    @Test
    fun `without a recognized own device nothing is invalidated`() {
        server.enqueue(antwort(geraete(currentAlong = false)))
        vm.loadDevices()
        bis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.abruf.laedt }

        vm.redeemQuestion(null)
        bis("Fehler") { vm.geraeteState.value.abruf.errorMessage != null }
        assertEquals("t${R.string.tokens_self_unknown}", vm.geraeteState.value.abruf.errorMessage.text)
        assertNull(vm.geraeteState.value.prompt)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `after the password change it signs out`() {
        server.enqueue(antwort("""{"success":true}"""))
        vm.aenderePasswort("alt", "neuNeuNeu123!")
        bis("Meldung") { kanal.text != null }

        assertTrue(abgemeldet)
        assertEquals("t${R.string.konto_password_changed}", kanal.text)
        assertFalse(vm.kontoState.value.speichern.laeuft)
    }

    @Test
    fun `a rejected password change does not report to sign out`() {
        server.enqueue(antwort("""{"success":false,"error":"Aktuelles Passwort falsch","code":"passwort_falsch"}""", 400))
        vm.aenderePasswort("falsch", "neuNeuNeu123!")
        bis("Fehler") { vm.kontoState.value.speichern.errorMessage != null }

        assertFalse(abgemeldet)
        // Die Absage kommt als Fehlerstatus mit dem Satz des Servers.
        assertEquals("Aktuelles Passwort falsch", vm.kontoState.value.speichern.errorMessage.text)
        assertNull(kanal.text)
    }

    @Test
    fun `the confirmed second factor shows the codes`() {
        server.enqueue(antwort("""{"success":true,"codes":["aaaa-1111","bbbb-2222"]}"""))
        vm.bestaetigeZweitenFaktor(" 123456 ")
        bis("Codes") { vm.secondFactorState.value.codes.isNotEmpty() }

        val z = vm.secondFactorState.value
        assertEquals(true, z.aktiv)
        assertEquals(2, z.codesUebrig)
        assertNull(z.geheimnis)
        assertFalse(z.abruf.laedt)
        assertEquals("t${R.string.zf_enabled}", kanal.text)
        // Der Code geht ohne Leerzeichen hinaus.
        assertTrue(server.takeRequest().body.readUtf8().contains("\"123456\""))
    }

    @Test
    fun `a foreign address instead of otpauth is not opened`() {
        server.enqueue(antwort("""{"success":true,"geheimnis":"JBSWY3DPEHPK3PXP",
            "otpauth":"intent://totp/#Intent;scheme=otpauth;end"}"""))
        vm.setUpSecondFactorOne("geheim")
        bis("Einrichtung") { vm.secondFactorState.value.geheimnis != null }
        assertNull("Nur otpauth:// geht an ACTION_VIEW", vm.secondFactorState.value.otpauth)
        assertEquals("Der Schlüssel bleibt zum Abtippen", "JBSWY3DPEHPK3PXP", vm.secondFactorState.value.geheimnis)

        val echt = "otpauth://totp/BrickInventory%3Amarco?secret=JBSWY3DPEHPK3PXP"
        server.enqueue(antwort("""{"success":true,"geheimnis":"JBSWY3DPEHPK3PXQ","otpauth":"$echt"}"""))
        vm.setUpSecondFactorOne("geheim")
        bis("zweite Einrichtung") { vm.secondFactorState.value.geheimnis == "JBSWY3DPEHPK3PXQ" }
        assertEquals(echt, vm.secondFactorState.value.otpauth)
    }

    @Test
    fun `without a code the second factor requires the code field, with a code the change goes through`() {
        server.enqueue(antwort("""{"success":false,"error":"Bitte den Code eingeben.","code":"zweiter_faktor_noetig"}""", 400))
        vm.aenderePasswort("alt", "neuNeuNeu123!")
        bis("Absage") { vm.kontoState.value.speichern.errorMessage != null }
        assertTrue("Das Codefeld erscheint", vm.kontoState.value.codeNoetig)
        assertFalse(abgemeldet)
        server.takeRequest()

        server.enqueue(antwort("""{"success":true}"""))
        vm.aenderePasswort("alt", "neuNeuNeu123!", " 123456 ")
        bis("abgemeldet") { abgemeldet }
        assertTrue(server.takeRequest().body.readUtf8().contains("\"code\":\"123456\""))
    }

    @Test
    fun `without a password the profile does not ask the server`() {
        vm.saveProfile("marco2", "marco@example.org", "", "", null)
        assertEquals("t${R.string.konto_profil_password_needed}", vm.kontoState.value.speichern.errorMessage.text)
        vm.saveProfile("marco2", "marco@example.org", "", "", "  ")
        assertEquals(0, server.requestCount)
        assertFalse(vm.kontoState.value.speichern.laeuft)
    }

    @Test
    fun `a new name carries the password along`() {
        server.enqueue(antwort("""{"success":true}"""))
        server.enqueue(antwort("""{"success":true,"user":{"id":1,"username":"marco2"}}"""))
        vm.saveProfile("marco2", "marco@example.org", "", "", "Mein-Passwort-1")
        bis("gespeichert") { vm.kontoState.value.meldung != null }
        val rumpf = server.takeRequest().body.readUtf8()
        assertTrue(rumpf, rumpf.contains("\"password_current\":\"Mein-Passwort-1\"") && rumpf.contains("\"username\":\"marco2\""))
    }

    @Test
    fun `a new e-mail carries the code along`() {
        server.enqueue(antwort("""{"success":false,"error":"Bitte den Code eingeben.","code":"zweiter_faktor_noetig"}""", 400))
        vm.saveProfile("marco", "neu@example.org", "", "", "pw")
        bis("Absage") { vm.kontoState.value.codeNoetig }
        server.takeRequest()

        server.enqueue(antwort("""{"success":true}"""))
        server.enqueue(antwort("""{"success":true,"user":{"id":1,"username":"marco"}}"""))
        vm.saveProfile("marco", "neu@example.org", "", "", "pw", "654321")
        bis("gespeichert") { vm.kontoState.value.meldung != null }
        assertTrue(server.takeRequest().body.readUtf8().contains("\"code\":\"654321\""))
        assertFalse("Nach Erfolg kein Codefeld mehr", vm.kontoState.value.codeNoetig)
    }

    @Test
    fun `a new e-mail reports the link and shows it as pending`() {
        server.enqueue(antwort("""{"success":true,"emailChanged":true,"emailSent":true}"""))
        server.enqueue(antwort("""{"success":true,"user":{"id":1,"username":"marco","email":"alt@example.org",
            "email_verified":true,"new_email":"neu@example.org"}}"""))
        vm.saveProfile("marco", " neu@example.org ", "", "", "pw")
        bis("neu geladen") { vm.kontoState.value.profile != null }
        assertEquals(R.string.konto_email_link_gesendet, (vm.kontoState.value.meldung as Meldung.Resource).id)
        assertNull(vm.kontoState.value.speichern.errorMessage)
        assertEquals("Es gilt die alte Adresse", "alt@example.org", vm.kontoState.value.profile?.email)
        assertEquals("neu@example.org", vm.kontoState.value.profile?.emailNew)
    }

    @Test
    fun `a new e-mail without a sent mail reports an error instead of saved`() {
        server.enqueue(antwort("""{"success":true,"emailChanged":true,"emailSent":false}"""))
        server.enqueue(antwort("""{"success":true,"user":{"id":1,"username":"marco","email":"alt@example.org",
            "email_verified":true,"new_email":"neu@example.org"}}"""))
        vm.saveProfile("marco", "neu@example.org", "", "", "pw")
        bis("neu geladen") { vm.kontoState.value.profile != null }
        assertEquals("Der Fehler übersteht das Neuladen", "t${R.string.konto_email_nicht_gesendet}", vm.kontoState.value.speichern.errorMessage.text)
        assertNull("Kein „gespeichert“", vm.kontoState.value.meldung)
    }
}
