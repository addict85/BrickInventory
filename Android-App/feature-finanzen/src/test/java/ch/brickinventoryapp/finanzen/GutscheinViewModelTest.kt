package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.testing.GutscheineRepository
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.finanzen.ui.viewmodel.GutscheinViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.NummernTexte
import ch.brickinventoryapp.testing.ReihenServer
import ch.brickinventoryapp.testing.TestApi

/**
 * Das Gutschein-ViewModel, im Takt gegen Antworten in fester Reihenfolge.
 *
 * Möglich, seit es aus MainViewModel herausgelöst ist und Texte über eine
 * Schnittstelle bekommt statt über den Context.
 *
 * Gegenproben:
 *  - In speichere() die 422-Übernahme entfernt (nur Meldung): „aus dem PDF
 *    Gelesenes landet im Formular" rot — Nummer leer.
 *  - Die PDF-Prüfung `typ != "application/pdf"` entfernt: „eine Nicht-PDF-Datei
 *    geht nicht zum Server" rot — ein Abruf statt keinem.
 *  - Im finally von frageAlleGuthabenAb() wieder `lade()` statt
 *    `ladeGutscheine()`: „abgebrochener Lauf räumt auf und lädt neu" rot — die
 *    abgebrochene Coroutine lädt nicht mehr (zwei Abrufe statt drei).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GutscheinViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(uhr)
    private lateinit var server: ReihenServer
    private lateinit var cacheDir: File
    private lateinit var kanal: MeldungsKanal
    private lateinit var vm: GutscheinViewModel

    private fun antwort(rumpf: String, code: Int = 200) = TestApi.antwort(rumpf, code)

    /** Ohne die Uhr vorzustellen: Eine Wartezeit des Servers bleibt sichtbar stehen. */
    private fun bis(was: String, bedingung: () -> Boolean) {
        uhr.runCurrent()
        assertTrue(was, bedingung())
    }

    private val zweiKarten = """{"success":true,"vouchers":[
        {"id":1,"number":"6000111122223333","pin":"1234","amount":50,"currency":"CHF"},
        {"id":2,"number":"6000444455556666","pin":"5678","amount":25.5,"currency":"EUR"}]}"""

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        server = ReihenServer()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-gut-${System.nanoTime()}")
        cacheDir.mkdirs()
        val api = server.api
        kanal = MeldungsKanal()
        vm = GutscheinViewModel(
            repo = GutscheineRepository(api, ResponseCache(io = takt) { cacheDir }),
            texte = NummernTexte,
            leser = object : DateiLeser { override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null },
            meldungen = kanal,
        )
    }

    @After
    fun zu() {
        server.shutdown()
        server.pruefeEinlesen()
        cacheDir.deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `die Liste wird geladen und ein Gutschein ins Formular geholt`() {
        server.enqueue(antwort(zweiKarten))
        vm.ladeGutscheine()
        bis("Liste") { vm.state.value.gutscheine.size == 2 && !vm.state.value.laedt }

        vm.bearbeiteGutschein(1)
        val s = vm.state.value
        assertEquals(1, s.bearbeitet)
        assertEquals("6000111122223333", s.nummer)
        // Ganze Beträge ohne „.0" — was im Feld steht, tippt der Nutzer weiter.
        assertEquals("50", s.betrag)
        vm.bearbeiteGutschein(2)
        assertEquals("25.5", vm.state.value.betrag)
        assertEquals("EUR", vm.state.value.waehrung)
    }

    @Test
    fun `aus dem PDF Gelesenes landet im Formular`() {
        server.enqueue(antwort("""{"success":false,"error":"Betrag fehlt",
            "gelesen":{"number":"6000999988887777","pin":"4321","currency":"EUR"}}""", 422))
        vm.speichere { "application/pdf" to byteArrayOf(37, 80, 68, 70) }
        bis("Formular") { !vm.state.value.speichert && server.requestCount == 1 && kanal.meldung.value != null }

        val s = vm.state.value
        assertEquals("6000999988887777", s.nummer)
        assertEquals("4321", s.pin)
        assertEquals("EUR", s.waehrung)
        assertEquals("", s.betrag)
        assertEquals("t${R.string.vouchers_pdf_incomplete}", kanal.meldung.value)
        assertTrue(server.takeRequest().path.endsWith("/api/v1/vouchers/pdf"))
    }

    @Test
    fun `eine Nicht-PDF-Datei geht nicht zum Server`() {
        vm.speichere { "image/png" to byteArrayOf(1, 2, 3) }
        bis("Meldung") { kanal.meldung.value != null && !vm.state.value.speichert }
        assertEquals("t${R.string.vouchers_only_pdf}", kanal.meldung.value)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `abgebrochener Lauf raeumt auf und laedt neu`() {
        server.enqueue(antwort(zweiKarten))
        vm.ladeGutscheine()
        bis("Liste") { vm.state.value.gutscheine.size == 2 }

        // Die Schranke meldet „abstand": Das ViewModel wartet sichtbar.
        server.enqueue(antwort("""{"success":false,"code":"guthaben_abstand","grund":"abstand","wartenSek":30}""", 429))
        server.enqueue(antwort(zweiKarten))
        vm.frageAlleGuthabenAb()
        bis("Wartezeit") { (vm.state.value.guthabenLauf?.wartenSek ?: 0) > 0 }
        assertEquals(2, vm.state.value.guthabenLauf?.gesamt)

        vm.guthabenLaufAbbrechen()
        bis("neu geladen") { server.requestCount == 3 }
        assertNull(vm.state.value.guthabenLauf)
        assertNull(vm.state.value.guthabenLaeuft)
        assertEquals("t${R.string.vouchers_balance_alle_fertig}", kanal.meldung.value)
    }

    // Gegenprobe (02.11.2026 gemessen): `|| d.grund == "konto"` im ViewModel
    // gestrichen → rot, auch /vouchers/2/guthaben wurde abgefragt (2 statt 1).
    @Test
    fun `Kontogrenze bricht den Durchgang ab`() {
        server.enqueue(antwort(zweiKarten))
        vm.ladeGutscheine()
        bis("Liste") { vm.state.value.gutscheine.size == 2 }

        server.enqueue(antwort("""{"success":false,"code":"zu_viele_anfragen","error":"Zu viele Abfragen","grund":"konto","wartenSek":1800}""", 429))
        server.enqueue(antwort(zweiKarten))
        vm.frageAlleGuthabenAb()
        // Liste, eine Abfrage, dann das Neuladen im finally – keine zweite Karte.
        uhr.advanceUntilIdle()
        bis("neu geladen") { server.requestCount >= 3 }
        val pfade = List(server.requestCount) { server.takeRequest().path.orEmpty() }
        assertEquals("nach der Kontogrenze keine zweite Karte: $pfade", 1, pfade.count { "guthaben" in it })
    }
}
