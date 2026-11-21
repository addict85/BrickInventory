package ch.brickinventoryapp.finances

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.testing.testVouchersRepository
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.finances.ui.viewmodel.GutscheinViewModel
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
import ch.brickinventoryapp.testing.NumbersTexts
import ch.brickinventoryapp.testing.RowsServer
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.text

/**
 * The voucher ViewModel, in step against answers in a fixed order.
 *
 * Possible since it was separated out of MainViewModel and gets its
 * texts through an interface instead of through the Context.
 *
 * Counter-checks:
 *  - In speichere() the 422 takeover removed (message only): "what was read
 *    from the PDF ends up in the form" red — number empty.
 *  - The PDF check `typ != "application/pdf"` removed: "a non-PDF file
 *    does not go to the server" red — one fetch instead of none.
 *  - In the finally of questionAllBalanceAb() back to `lade()` instead of
 *    `loadVouchers()`: "a cancelled run cleans up and reloads" red — the
 *    cancelled coroutine no longer loads (two fetches instead of three).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoucherViewModelTest {

    private val clock = TestCoroutineScheduler()
    private val takt = UnconfinedTestDispatcher(clock)
    private lateinit var server: RowsServer
    private lateinit var cacheDir: File
    private lateinit var kanal: MeldungsKanal
    private lateinit var vm: GutscheinViewModel

    private fun antwort(rumpf: String, code: Int = 200) = TestApi.antwort(rumpf, code)

    /** Without advancing the clock: a server wait period visibly stays put. */
    private fun bis(was: String, bedingung: () -> Boolean) {
        clock.runCurrent()
        assertTrue(was, bedingung())
    }

    private val twoCards = """{"success":true,"vouchers":[
        {"id":1,"number":"6000111122223333","pin":"1234","amount":50,"currency":"CHF"},
        {"id":2,"number":"6000444455556666","pin":"5678","amount":25.5,"currency":"EUR"}]}"""

    @Before
    fun auf() {
        Dispatchers.setMain(takt)
        server = RowsServer()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-gut-${System.nanoTime()}")
        cacheDir.mkdirs()
        val api = server.api
        kanal = MeldungsKanal()
        vm = GutscheinViewModel(
            repo = testVouchersRepository(api),
            texts = NumbersTexts,
            reader = object : FileReader { override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null },
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
    fun `the list is loaded and a voucher is fetched into the form`() {
        server.enqueue(antwort(twoCards))
        vm.loadVouchers()
        bis("Liste") { vm.state.value.gutscheine.size == 2 && !vm.state.value.abruf.laedt }

        vm.editVoucher(1)
        val s = vm.state.value
        assertEquals(1, s.edited)
        assertEquals("6000111122223333", s.nummer)
        // Whole amounts without ".0" — what stands in the field is what the user keeps typing.
        assertEquals("50", s.betrag)
        vm.editVoucher(2)
        assertEquals("25.5", vm.state.value.betrag)
        assertEquals("EUR", vm.state.value.waehrung)
    }

    @Test
    fun `what was read from the PDF lands in the form`() {
        server.enqueue(antwort("""{"success":false,"error":"Betrag fehlt",
            "gelesen":{"number":"6000999988887777","pin":"4321","currency":"EUR"}}""", 422))
        vm.speichere { "application/pdf" to byteArrayOf(37, 80, 68, 70) }
        bis("Formular") { !vm.state.value.speichern.laeuft && server.requestCount == 1 && kanal.text != null }

        val s = vm.state.value
        assertEquals("6000999988887777", s.nummer)
        assertEquals("4321", s.pin)
        assertEquals("EUR", s.waehrung)
        assertEquals("", s.betrag)
        assertEquals("t${R.string.vouchers_pdf_incomplete}", kanal.text)
        assertTrue(server.takeRequest().path.endsWith("/api/v1/vouchers/pdf"))
    }

    @Test
    fun `a non-PDF file does not go to the server`() {
        vm.speichere { "image/png" to byteArrayOf(1, 2, 3) }
        bis("Meldung") { kanal.text != null && !vm.state.value.speichern.laeuft }
        assertEquals("t${R.string.vouchers_only_pdf}", kanal.text)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `an aborted run cleans up and reloads`() {
        server.enqueue(antwort(twoCards))
        vm.loadVouchers()
        bis("Liste") { vm.state.value.gutscheine.size == 2 }

        // Die Schranke meldet „abstand": Das ViewModel wartet sichtbar.
        server.enqueue(antwort("""{"success":false,"code":"guthaben_abstand","grund":"abstand","wartenSek":30}""", 429))
        server.enqueue(antwort(twoCards))
        vm.questionAllBalanceAb()
        bis("Wartezeit") { (vm.state.value.balanceRun?.wartenSek ?: 0) > 0 }
        assertEquals(2, vm.state.value.balanceRun?.gesamt)

        vm.cancelBalanceRun()
        bis("neu geladen") { server.requestCount == 3 }
        assertNull(vm.state.value.balanceRun)
        assertNull(vm.state.value.balanceRunning)
        assertEquals("t${R.string.vouchers_balance_alle_fertig}", kanal.text)
    }

    // Counter-check (measured 02.11.2026): `|| d.grund == "konto"` removed in the ViewModel
    // → red, /vouchers/2/guthaben was also queried (2 instead of 1).
    @Test
    fun `the account limit aborts the pass`() {
        server.enqueue(antwort(twoCards))
        vm.loadVouchers()
        bis("Liste") { vm.state.value.gutscheine.size == 2 }

        server.enqueue(antwort("""{"success":false,"code":"zu_viele_anfragen","error":"Zu viele Abfragen","grund":"konto","wartenSek":1800}""", 429))
        server.enqueue(antwort(twoCards))
        vm.questionAllBalanceAb()
        // List, one query, then the reload in the finally — no second card.
        clock.advanceUntilIdle()
        bis("neu geladen") { server.requestCount >= 3 }
        val paths = List(server.requestCount) { server.takeRequest().path.orEmpty() }
        assertEquals("nach der Kontogrenze keine zweite Karte: $paths", 1, paths.count { "guthaben" in it })
    }
}
