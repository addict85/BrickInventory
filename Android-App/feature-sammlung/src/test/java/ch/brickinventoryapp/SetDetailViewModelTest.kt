package ch.brickinventoryapp

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.model.SetAggregate
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Das Set-Detail-ViewModel, ausgeführt gegen einen Testserver.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen SetDetailViewModel.kt):
 *   A  setNumber nicht aus dem SavedStateHandle, sondern "" → alle vier rot,
 *      zuerst „das Set kommt aus dem SavedStateHandle …“
 *   B  in updateQuantity() das Melden entfernt → rot „eine geänderte Menge …“
 *      (30.10. nach dem Angleichen der Nachlade-Antwort erneut gemessen;
 *      ebenso E für „der Regler …“)
 *   C  in beiAenderung() den Vergleich der Setnummer weggelassen → rot „ein
 *      geänderter Kauf eines anderen Sets lädt hier nichts“
 *   D  den Alarme-Zweig in beiAenderung() entfernt → rot „ein gespeicherter
 *      Preisalarm wird gemeldet und neu geladen“
 *   E  in aendereMengeUm() wieder UpdateQuantityRequest(quantity = schritt)
 *      → rot „der Regler schickt einen Schritt …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SetDetailViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private val keinLeser = object : DateiLeser { override suspend fun lies(uri: Uri): Pair<String?, ByteArray>? = null }

    private fun vm(setNumber: String = "75192-1") = t.merke(SetDetailViewModel(
        t.dienste, SetsRepository(t.api, t.cache), FinanzenRepository(t.api, t.cache),
        HaushaltRepository(t.api, t.cache), keinLeser, SavedStateHandle(mapOf("setNumber" to setNumber))))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/sets/75192-1" to """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Falke","quantity":2}}""",
            "/api/v1/sets/75192-1/price" to """{"success":true,"set_number":"75192-1"}""",
            "/api/v1/sets/75192-1/price-history" to """{"success":true,"set_number":"75192-1"}""",
            "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[{"id":1,"quantity":2}]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true,"alerts":[]}""",
        )
        t = TestDienste(pfade.server)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    /**
     * Nach dem PUT hat der Server 3; das Nachladen nach der Meldung muss dieselbe
     * Zahl liefern, sonst überschreibt es die 3, bevor der Test sie sieht.
     */
    private fun serverHatDanachDrei() {
        pfade.antworten["/api/v1/sets/75192-1"] =
            """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Falke","quantity":3}}"""
    }

    private fun geladen(vm: SetDetailViewModel) = TestApi.warteBis("Detail geladen") {
        vm.setDetailState.value.setDetail != null && vm.setDetailState.value.acquisitions.isNotEmpty()
    }

    @Test
    fun `das Set kommt aus dem SavedStateHandle und alles wird dafuer geladen`() {
        val vm = vm()
        assertEquals("75192-1", vm.setNumber)
        vm.ladeAlles()
        geladen(vm)
        TestApi.warteBis("alle fünf Abrufe") {
            listOf("/75192-1/price-history", "/75192-1/price?", "/75192-1/alert").all { p ->
                pfade.anfragen.any { p.removeSuffix("?") in it }
            }
        }
        assertEquals("Falke", vm.setDetailState.value.setDetail?.name)
    }

    @Test
    fun `eine geaenderte Menge steht sofort da und wird gemeldet`() {
        val vm = vm()
        vm.ladeAlles()
        geladen(vm)
        serverHatDanachDrei()
        val liste = t.gemeldet(1) {
            // Gewünscht 5, der Server deckelt auf 3 (fremde Exemplare lassen sich
            // nicht wegnehmen): Es gilt seine Zahl, nicht die eigene Annahme.
            vm.updateQuantity("75192-1", 5)
            TestApi.warteBis("Menge da") { vm.setDetailState.value.setDetail?.quantity == 3 }
        }
        assertEquals(listOf(Aenderung.Sets), liste)
        assertTrue(pfade.anfragenAn("PUT /api/v1/sets/75192-1").isNotEmpty())
    }

    @Test
    fun `der Regler schickt einen Schritt, keine Zielzahl`() {
        val vm = vm()
        vm.ladeAlles()
        geladen(vm)
        serverHatDanachDrei()
        vm.aendereMengeUm("75192-1", -1)
        TestApi.warteBis("PUT gesendet") { pfade.anfragenAn("PUT /api/v1/sets/75192-1").isNotEmpty() }
        val i = pfade.anfragen.indexOfFirst { "PUT /api/v1/sets/75192-1" in it }
        val rumpf = pfade.koerper[i]
        assertTrue(rumpf, "\"quantity_delta\":-1" in rumpf)
        assertTrue(rumpf, "\"quantity\":" !in rumpf)
        TestApi.warteBis("Menge vom Server") { vm.setDetailState.value.setDetail?.quantity == 3 }
    }

    @Test
    fun `ein geaenderter Kauf eines anderen Sets laedt hier nichts, einer dieses Sets schon`() {
        val vm = vm()
        vm.ladeAlles()
        geladen(vm)
        Thread.sleep(200)
        val vorher = pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size

        t.bestand.melde(Aenderung.SetZusammenfassung(SetAggregate(setNumber = "10294-1")))
        Thread.sleep(200)
        assertEquals(vorher, pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size)

        t.bestand.melde(Aenderung.SetZusammenfassung(SetAggregate(setNumber = "75192-1")))
        TestApi.warteBis("neu geladen") {
            pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size > vorher
        }
    }

    @Test
    fun `ein gespeicherter Preisalarm wird gemeldet und neu geladen`() {
        val vm = vm()
        vm.ladeAlles()
        geladen(vm)
        Thread.sleep(200)
        val vorher = pfade.anfragenAn("GET /api/v1/sets/75192-1/alert").size
        val liste = t.gemeldet(1) {
            vm.setzePreisalarm("75192-1", "unter", "450", "N")
            uhr.advanceTimeBy(900)
            TestApi.warteBis("neu geladen") { pfade.anfragenAn("GET /api/v1/sets/75192-1/alert").size > vorher }
        }
        assertEquals(listOf(Aenderung.Alarme), liste)
        assertEquals(1, pfade.anfragenAn("PUT /api/v1/sets/75192-1/alert").size)
    }
}
