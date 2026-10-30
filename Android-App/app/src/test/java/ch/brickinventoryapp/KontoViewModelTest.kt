package ch.brickinventoryapp

import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.ui.viewmodel.KontoViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * Das Konto-ViewModel, ausgeführt gegen einen Testserver.
 *
 * Gegenproben:
 *  - In entwerteAndereGeraete() die Prüfung `liste.none { it.aktuell }`
 *    entfernt: „ohne erkanntes eigenes Gerät wird nichts entwertet" rot — es
 *    gingen zwei Entwertungen hinaus.
 *  - In aenderePasswort() den Aufruf `abmelden()` entfernt: „nach dem
 *    Passwortwechsel wird abgemeldet" rot.
 *  - In zweiterFaktor() `erfolgText` nicht mehr gemeldet: „der bestätigte
 *    zweite Faktor zeigt die Codes" rot an der Meldung.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class KontoViewModelTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var kanal: MeldungsKanal
    private lateinit var vm: KontoViewModel

    private fun antwort(rumpf: String, code: Int = 200) = TestApi.antwort(rumpf, code)
    private fun warteBis(was: String, bedingung: () -> Boolean) = TestApi.warteBis(was, bedingung)

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-konto-${System.nanoTime()}")
        cacheDir.mkdirs()
        kanal = MeldungsKanal()
        vm = KontoViewModel(KontoRepository(TestApi.fuer(server), ResponseCache { cacheDir }), NummernTexte, kanal,
                            ch.brickinventoryapp.ui.Sitzung())
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
        Dispatchers.resetMain()
    }

    private fun geraete(aktuellDabei: Boolean) = """{"success":true,"tokens":[
        {"token_id":"a1","label":"Telefon","aktuell":$aktuellDabei},
        {"token_id":"b2","label":"Tablet"},
        {"token_id":"c3","label":"Alt"}]}"""

    @Test
    fun `andere Geraete werden entwertet, das eigene bleibt`() {
        server.enqueue(antwort(geraete(aktuellDabei = true)))
        vm.ladeGeraete()
        warteBis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.laedt }
        server.takeRequest()

        server.enqueue(antwort("""{"success":true}"""))
        server.enqueue(antwort("""{"success":true}"""))
        server.enqueue(antwort(geraete(aktuellDabei = true)))
        vm.entwerteAndereGeraete()
        warteBis("neu geladen") { server.requestCount == 4 && !vm.geraeteState.value.laedt }

        val entwertet = (1..2).map { server.takeRequest().path.orEmpty() }
        assertTrue("Entwertet: $entwertet", entwertet.any { it.endsWith("b2") } && entwertet.any { it.endsWith("c3") })
        assertFalse(entwertet.any { it.endsWith("a1") })
        assertEquals("m${R.plurals.tokens_revoked_n}:2", kanal.fluss.value)
    }

    @Test
    fun `ohne erkanntes eigenes Geraet wird nichts entwertet`() {
        server.enqueue(antwort(geraete(aktuellDabei = false)))
        vm.ladeGeraete()
        warteBis("Liste") { vm.geraeteState.value.geraete.size == 3 && !vm.geraeteState.value.laedt }

        vm.entwerteAndereGeraete()
        warteBis("Fehler") { vm.geraeteState.value.fehler != null }
        assertEquals("t${R.string.tokens_self_unknown}", vm.geraeteState.value.fehler)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `nach dem Passwortwechsel wird abgemeldet`() {
        var abgemeldet = false
        server.enqueue(antwort("""{"success":true}"""))
        vm.aenderePasswort("alt", "neuNeuNeu123!") { abgemeldet = true }
        warteBis("Meldung") { kanal.fluss.value != null }

        assertTrue(abgemeldet)
        assertEquals("t${R.string.konto_password_changed}", kanal.fluss.value)
        assertFalse(vm.kontoState.value.speichert)
    }

    @Test
    fun `ein abgelehnter Passwortwechsel meldet abzumelden nicht`() {
        var abgemeldet = false
        server.enqueue(antwort("""{"success":false,"error":"Aktuelles Passwort falsch"}"""))
        vm.aenderePasswort("falsch", "neuNeuNeu123!") { abgemeldet = true }
        warteBis("Fehler") { vm.kontoState.value.fehler != null }

        assertFalse(abgemeldet)
        assertEquals("Aktuelles Passwort falsch", vm.kontoState.value.fehler)
        assertNull(kanal.fluss.value)
    }

    @Test
    fun `der bestaetigte zweite Faktor zeigt die Codes`() {
        server.enqueue(antwort("""{"success":true,"codes":["aaaa-1111","bbbb-2222"]}"""))
        vm.bestaetigeZweitenFaktor(" 123456 ")
        warteBis("Codes") { vm.zweiterFaktorState.value.codes.isNotEmpty() }

        val z = vm.zweiterFaktorState.value
        assertEquals(true, z.aktiv)
        assertEquals(2, z.codesUebrig)
        assertNull(z.geheimnis)
        assertFalse(z.laedt)
        assertEquals("t${R.string.zf_enabled}", kanal.fluss.value)
        // Der Code geht ohne Leerzeichen hinaus.
        assertTrue(server.takeRequest().body.readUtf8().contains("\"123456\""))
    }
}
