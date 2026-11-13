package ch.brickinventoryapp.konto

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.konto.ui.viewmodel.KontoViewModel
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
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.testing.NummernTexte
import ch.brickinventoryapp.testing.ReihenServer
import ch.brickinventoryapp.testing.SitzungsAttrappe
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.text

/**
 * Das Konto-ViewModel, ausgeführt gegen einen Testserver.
 *
 * Gegenproben:
 *  - In frageEntwerten() die Prüfung `liste.none { it.aktuell }`
 *    entfernt: „ohne erkanntes eigenes Gerät wird nichts entwertet" rot — die
 *    Rückfrage ging auf.
 *  - In bestaetigeEntwerten() `codeNoetig` nicht gesetzt: „ein fremdes Gerät
 *    verlangt Passwort und bei Bedarf den Code" rot; das Passwort nicht in den
 *    Rumpf gelegt: dieselbe Prüfung rot (kein "password").
 *  - In aenderePasswort() den Aufruf `sitzungsDienst.abmelden()` entfernt: „nach dem
 *    Passwortwechsel wird abgemeldet" rot.
 *  - In zweiterFaktor() `erfolgText` nicht mehr gemeldet: „der bestätigte
 *    zweite Faktor zeigt die Codes" rot an der Meldung.
 *  - In alsGeraet() `.minOrNull()` → `.maxOrNull()`: „die
 *    Geräteliste zeigt Vollzugriff und die frühere Frist" rot (2027 statt 2026);
 *    `zugaenge` beim Zählen nicht beachtet: „ein schon entwertetes Gerät zählt
 *    nicht“ rot.
 *  - In abgelehnt() `codeNoetig` nicht gesetzt: „ohne Code
 *    verlangt der zweite Faktor …“ und „eine neue E-Mail …“ rot; in aenderePasswort()
 *    den Code nicht an changePassword() gereicht: dieselbe Prüfung rot (kein
 *    "code" im Rumpf).
 *  - In richteZweitenFaktorEin() `d.otpauth` ungeprüft übernommen:
 *    „eine fremde Adresse statt otpauth wird nicht geöffnet“ rot.
 *  - Patch gegenproben/profil-ohne-passwort.patch (die Prüfung
 *    `passwort.isNullOrBlank()` in speichereProfil() entfernt): „ohne Passwort
 *    fragt das Profil den Server nicht“ rot.
 *  - Patch gegenproben/profil-mail-nicht-gesendet-still.patch (`emailSent` nicht
 *    ausgewertet): „eine neue E-Mail ohne gesendete Mail …“ rot. Patch
 *    gegenproben/profil-neu-laden-loescht-fehler.patch (holeProfil() setzt den
 *    Fehler wieder auf null): dieselbe Prüfung rot an „übersteht das Neuladen“.
 *  - Patch gegenproben/konto-laedt-nicht-beim-beobachten.patch (ladeBeimBeobachten für
 *    Geräte und zweiten Faktor gestrichen): „Geräte und zweiter Faktor laden, sobald …“ rot.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class KontoViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(uhr)
    private lateinit var server: ReihenServer
    private lateinit var cacheDir: File
    private lateinit var kanal: MeldungsKanal
    private lateinit var vm: KontoViewModel

    @Volatile private var abgemeldet = false

    private fun antwort(rumpf: String, code: Int = 200) = TestApi.antwort(rumpf, code)

    /** Im Takt ist ein Zustand da, sobald die anstehenden Schritte gelaufen sind, oder nie. */
    private fun bis(was: String, bedingung: () -> Boolean) {
        uhr.runCurrent()
        assertTrue(was, bedingung())
    }

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        server = ReihenServer()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-konto-${System.nanoTime()}")
        cacheDir.mkdirs()
        kanal = MeldungsKanal()
        vm = KontoViewModel(KontoRepository(server.api, ResponseCache(io = takt) { cacheDir }, takt), NummernTexte, kanal,
                            Sitzung(), SitzungsAttrappe { abgemeldet = true })
    }

    @After
    fun zu() {
        server.shutdown()
        server.pruefeEinlesen()
        cacheDir.deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `Geraete und zweiter Faktor laden, sobald jemand ihren Zustand beobachtet`() {
        uhr.runCurrent()
        assertEquals("ohne Beobachter kein Abruf", 0, server.requestCount)
        server.enqueue(antwort(geraete(aktuellDabei = true)))
        val geraeteSeite = CoroutineScope(takt).launch { vm.geraeteState.collect {} }
        bis("Geräte") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.laedt }
        server.enqueue(antwort("""{"success":true,"aktiv":true,"codes_uebrig":8}"""))
        val faktorSeite = CoroutineScope(takt).launch { vm.zweiterFaktorState.collect {} }
        bis("zweiter Faktor") { vm.zweiterFaktorState.value.aktiv == true && vm.zweiterFaktorState.value.codesUebrig == 8 }
        geraeteSeite.cancel()
        faktorSeite.cancel()
        assertEquals(2, server.requestCount)
    }

    private fun geraete(aktuellDabei: Boolean) = """{"success":true,"tokens":[
        {"token_id":"a1","label":"Telefon","aktuell":$aktuellDabei},
        {"token_id":"b2","label":"Tablet"},
        {"token_id":"c3","label":"Alt"}]}"""

    @Test
    fun `andere Geraete gehen in einer bestaetigten Anfrage, das eigene bleibt`() {
        server.enqueue(antwort(geraete(aktuellDabei = true)))
        vm.ladeGeraete()
        bis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.laedt }
        server.takeRequest()

        vm.frageEntwerten(null)
        bis("Rückfrage") { vm.geraeteState.value.rueckfrage?.tokenId == null && vm.geraeteState.value.rueckfrage != null }
        server.enqueue(antwort("""{"success":true,"deleted":0,"zugaenge":2}"""))
        server.enqueue(antwort(geraete(aktuellDabei = true)))
        vm.bestaetigeEntwerten("geheim", null)
        bis("neu geladen") { server.requestCount == 3 && !vm.geraeteState.value.laedt }

        val r = server.takeRequest()
        assertTrue(r.path.orEmpty(), r.path.orEmpty().endsWith("/settings/sessions/andere-beenden"))
        val rumpf = r.body.readUtf8()
        assertTrue(rumpf, rumpf.contains("\"password\":\"geheim\"") && rumpf.contains("\"zugaenge\":true"))
        assertNull(vm.geraeteState.value.rueckfrage)
        assertEquals("m${R.plurals.tokens_revoked_n}:2", kanal.text)
    }

    @Test
    fun `ein fremdes Geraet verlangt Passwort und bei Bedarf den Code`() {
        server.enqueue(antwort(geraete(aktuellDabei = true)))
        vm.ladeGeraete()
        bis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.laedt }
        server.takeRequest()

        vm.frageEntwerten("b2")
        server.enqueue(antwort("""{"success":false,"error":"Code fehlt","code":"zweiter_faktor_noetig"}""", 400))
        vm.bestaetigeEntwerten("geheim", null)
        bis("Code verlangt") { vm.geraeteState.value.rueckfrage?.codeNoetig == true }
        val ohne = server.takeRequest()
        assertEquals("DELETE", ohne.method)
        assertTrue(ohne.path.orEmpty(), ohne.path.orEmpty().endsWith("/settings/tokens/b2"))
        assertTrue(ohne.body.readUtf8().contains("\"password\":\"geheim\""))

        server.enqueue(antwort("""{"success":true,"deleted":1}"""))
        server.enqueue(antwort(geraete(aktuellDabei = true)))
        vm.bestaetigeEntwerten("geheim", "123456")
        bis("erledigt") { server.requestCount == 4 && vm.geraeteState.value.rueckfrage == null }
        assertTrue(server.takeRequest().body.readUtf8().contains("\"code\":\"123456\""))
        assertEquals("t${R.string.tokens_revoked}", kanal.text)
    }

    @Test
    fun `die Geräteliste zeigt Vollzugriff und die frühere Frist`() {
        server.enqueue(antwort("""{"success":true,"tokens":[
            {"token_prefix":"abcd1234","token_id":"abcd1234abcd1234","label":"Rechner","created_at":"2026-01-01T00:00:00Z",
             "last_used":null,"expires_at":"2027-03-01T00:00:00Z","hard_expires_at":"2026-12-01T00:00:00Z",
             "never_expires":false,"scope":"voll","ip_bereich":"192.168.1.0/24","rotiert_am":null,"aktuell":false},
            {"token_prefix":"ffff0000","token_id":"ffff0000ffff0000","label":"","created_at":"2026-01-01T00:00:00Z",
             "last_used":null,"expires_at":null,"hard_expires_at":null,"never_expires":true,"scope":"app",
             "ip_bereich":null,"rotiert_am":"2026-10-01T00:00:00Z","aktuell":true}]}"""))
        vm.ladeGeraete()
        bis("Liste") { vm.geraeteState.value.geraete.size == 2 }
        val (voll, eigen) = vm.geraeteState.value.geraete
        assertTrue(voll.vollerZugriff)
        assertEquals("2026-12-01T00:00:00Z", voll.laeuftAb)
        assertEquals("192.168.1.0/24", voll.ipBereich)
        assertFalse(eigen.vollerZugriff)
        assertEquals("unbegrenzt", null, eigen.laeuftAb)
        assertEquals("—", eigen.bezeichnung)
    }

    @Test
    fun `ein schon entwertetes Gerät zählt nicht`() {
        server.enqueue(antwort(geraete(aktuellDabei = true)))
        vm.ladeGeraete()
        bis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.laedt }
        vm.frageEntwerten(null)
        server.enqueue(antwort("""{"success":true,"deleted":1,"zugaenge":0}"""))
        server.enqueue(antwort(geraete(aktuellDabei = true)))
        vm.bestaetigeEntwerten("geheim", null)
        bis("neu geladen") { server.requestCount == 3 && !vm.geraeteState.value.laedt }
        assertEquals("m${R.plurals.tokens_revoked_n}:0", kanal.text)
    }

    @Test
    fun `ohne erkanntes eigenes Geraet wird nichts entwertet`() {
        server.enqueue(antwort(geraete(aktuellDabei = false)))
        vm.ladeGeraete()
        bis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.laedt }

        vm.frageEntwerten(null)
        bis("Fehler") { vm.geraeteState.value.fehler != null }
        assertEquals("t${R.string.tokens_self_unknown}", vm.geraeteState.value.fehler)
        assertNull(vm.geraeteState.value.rueckfrage)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `nach dem Passwortwechsel wird abgemeldet`() {
        server.enqueue(antwort("""{"success":true}"""))
        vm.aenderePasswort("alt", "neuNeuNeu123!")
        bis("Meldung") { kanal.text != null }

        assertTrue(abgemeldet)
        assertEquals("t${R.string.konto_password_changed}", kanal.text)
        assertFalse(vm.kontoState.value.speichert)
    }

    @Test
    fun `ein abgelehnter Passwortwechsel meldet abzumelden nicht`() {
        server.enqueue(antwort("""{"success":false,"error":"Aktuelles Passwort falsch"}"""))
        vm.aenderePasswort("falsch", "neuNeuNeu123!")
        bis("Fehler") { vm.kontoState.value.fehler != null }

        assertFalse(abgemeldet)
        assertEquals("Aktuelles Passwort falsch", vm.kontoState.value.fehler)
        assertNull(kanal.text)
    }

    @Test
    fun `der bestaetigte zweite Faktor zeigt die Codes`() {
        server.enqueue(antwort("""{"success":true,"codes":["aaaa-1111","bbbb-2222"]}"""))
        vm.bestaetigeZweitenFaktor(" 123456 ")
        bis("Codes") { vm.zweiterFaktorState.value.codes.isNotEmpty() }

        val z = vm.zweiterFaktorState.value
        assertEquals(true, z.aktiv)
        assertEquals(2, z.codesUebrig)
        assertNull(z.geheimnis)
        assertFalse(z.laedt)
        assertEquals("t${R.string.zf_enabled}", kanal.text)
        // Der Code geht ohne Leerzeichen hinaus.
        assertTrue(server.takeRequest().body.readUtf8().contains("\"123456\""))
    }

    @Test
    fun `eine fremde Adresse statt otpauth wird nicht geöffnet`() {
        server.enqueue(antwort("""{"success":true,"geheimnis":"JBSWY3DPEHPK3PXP",
            "otpauth":"intent://totp/#Intent;scheme=otpauth;end"}"""))
        vm.richteZweitenFaktorEin("geheim")
        bis("Einrichtung") { vm.zweiterFaktorState.value.geheimnis != null }
        assertNull("Nur otpauth:// geht an ACTION_VIEW", vm.zweiterFaktorState.value.otpauth)
        assertEquals("Der Schlüssel bleibt zum Abtippen", "JBSWY3DPEHPK3PXP", vm.zweiterFaktorState.value.geheimnis)

        val echt = "otpauth://totp/BrickInventory%3Amarco?secret=JBSWY3DPEHPK3PXP"
        server.enqueue(antwort("""{"success":true,"geheimnis":"JBSWY3DPEHPK3PXQ","otpauth":"$echt"}"""))
        vm.richteZweitenFaktorEin("geheim")
        bis("zweite Einrichtung") { vm.zweiterFaktorState.value.geheimnis == "JBSWY3DPEHPK3PXQ" }
        assertEquals(echt, vm.zweiterFaktorState.value.otpauth)
    }

    @Test
    fun `ohne Code verlangt der zweite Faktor das Codefeld, mit Code geht der Wechsel durch`() {
        server.enqueue(antwort("""{"success":false,"error":"Bitte den Code eingeben.","code":"zweiter_faktor_noetig"}""", 400))
        vm.aenderePasswort("alt", "neuNeuNeu123!")
        bis("Absage") { vm.kontoState.value.fehler != null }
        assertTrue("Das Codefeld erscheint", vm.kontoState.value.codeNoetig)
        assertFalse(abgemeldet)
        server.takeRequest()

        server.enqueue(antwort("""{"success":true}"""))
        vm.aenderePasswort("alt", "neuNeuNeu123!", " 123456 ")
        bis("abgemeldet") { abgemeldet }
        assertTrue(server.takeRequest().body.readUtf8().contains("\"code\":\"123456\""))
    }

    @Test
    fun `ohne Passwort fragt das Profil den Server nicht`() {
        vm.speichereProfil("marco2", "marco@example.org", "", "", null)
        assertEquals("t${R.string.konto_profil_password_needed}", vm.kontoState.value.fehler)
        vm.speichereProfil("marco2", "marco@example.org", "", "", "  ")
        assertEquals(0, server.requestCount)
        assertFalse(vm.kontoState.value.speichert)
    }

    @Test
    fun `ein neuer Name traegt das Passwort mit`() {
        server.enqueue(antwort("""{"success":true}"""))
        server.enqueue(antwort("""{"success":true,"user":{"id":1,"username":"marco2"}}"""))
        vm.speichereProfil("marco2", "marco@example.org", "", "", "Mein-Passwort-1")
        bis("gespeichert") { vm.kontoState.value.meldung != null }
        val rumpf = server.takeRequest().body.readUtf8()
        assertTrue(rumpf, rumpf.contains("\"password_current\":\"Mein-Passwort-1\"") && rumpf.contains("\"username\":\"marco2\""))
    }

    @Test
    fun `eine neue E-Mail traegt den Code mit`() {
        server.enqueue(antwort("""{"success":false,"error":"Bitte den Code eingeben.","code":"zweiter_faktor_noetig"}""", 400))
        vm.speichereProfil("marco", "neu@example.org", "", "", "pw")
        bis("Absage") { vm.kontoState.value.codeNoetig }
        server.takeRequest()

        server.enqueue(antwort("""{"success":true}"""))
        server.enqueue(antwort("""{"success":true,"user":{"id":1,"username":"marco"}}"""))
        vm.speichereProfil("marco", "neu@example.org", "", "", "pw", "654321")
        bis("gespeichert") { vm.kontoState.value.meldung != null }
        assertTrue(server.takeRequest().body.readUtf8().contains("\"code\":\"654321\""))
        assertFalse("Nach Erfolg kein Codefeld mehr", vm.kontoState.value.codeNoetig)
    }

    @Test
    fun `eine neue E-Mail meldet den Link und zeigt sie als ausstehend`() {
        server.enqueue(antwort("""{"success":true,"emailChanged":true,"emailSent":true}"""))
        server.enqueue(antwort("""{"success":true,"user":{"id":1,"username":"marco","email":"alt@example.org",
            "email_verified":true,"email_neu":"neu@example.org"}}"""))
        vm.speichereProfil("marco", " neu@example.org ", "", "", "pw")
        bis("neu geladen") { vm.kontoState.value.profil != null }
        assertEquals("t${R.string.konto_email_link_gesendet}", vm.kontoState.value.meldung)
        assertNull(vm.kontoState.value.fehler)
        assertEquals("Es gilt die alte Adresse", "alt@example.org", vm.kontoState.value.profil?.email)
        assertEquals("neu@example.org", vm.kontoState.value.profil?.emailNeu)
    }

    @Test
    fun `eine neue E-Mail ohne gesendete Mail meldet einen Fehler statt gespeichert`() {
        server.enqueue(antwort("""{"success":true,"emailChanged":true,"emailSent":false}"""))
        server.enqueue(antwort("""{"success":true,"user":{"id":1,"username":"marco","email":"alt@example.org",
            "email_verified":true,"email_neu":"neu@example.org"}}"""))
        vm.speichereProfil("marco", "neu@example.org", "", "", "pw")
        bis("neu geladen") { vm.kontoState.value.profil != null }
        assertEquals("Der Fehler übersteht das Neuladen", "t${R.string.konto_email_nicht_gesendet}", vm.kontoState.value.fehler)
        assertNull("Kein „gespeichert“", vm.kontoState.value.meldung)
    }
}
