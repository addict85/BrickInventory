package ch.brickinventoryapp.sammlung

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Zustand
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.data.model.SetAggregate
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.testing.FinanzenRepository
import ch.brickinventoryapp.testing.HaushaltRepository
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.offline.Faecher
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.sammlung.ui.viewmodel.SetDetailViewModel
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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * Das Set-Detail-ViewModel, ausgeführt gegen einen PfadServer ohne Netz.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen SetDetailViewModel.kt):
 *   A  setNumber nicht aus dem SavedStateHandle, sondern "" → alle vier rot,
 *      zuerst „das Set kommt aus dem SavedStateHandle …“
 *   B  in SetsRepositoryImpl.updateQuantity `r.quantity ?: quantity` durch `quantity`
 *      ersetzt → rot „eine geänderte Menge steht sofort da und in der Ablage“ (5 statt 3)
 *   C  im init von SetDetailViewModel `firstOrNull { it.setNumber == setNumber }`
 *      durch die ganze Liste ersetzt → rot „ein geänderter Kauf eines anderen Sets lädt hier nichts“
 *   D  in der Preisalarmeingabe `gespeichert` leer gelassen → rot „ein gespeicherter
 *      Preisalarm wird neu geladen“
 *   E  in aendereMengeUm() wieder UpdateQuantityRequest(quantity = schritt)
 *      → rot „der Regler schickt einen Schritt …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SetDetailViewModelTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private val keinLeser = object : DateiLeser { override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null }

    private fun vm(setNumber: String = "75192-1") = t.merke(SetDetailViewModel(t.sitzung, t.filter(), t.hinweise, t.sets(), t.setKatalog(), t.alarme(), t.setDateien(),
        FinanzenRepository(t.api, t.cache), HaushaltRepository(t.api, t.cache), keinLeser,
        SavedStateHandle(mapOf("setNumber" to setNumber))))

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/sets/75192-1" to """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Falke","quantity":2}}""",
            "/api/v1/sets/75192-1/price" to """{"success":true,"set_number":"75192-1"}""",
            "/api/v1/sets/75192-1/price-history" to """{"success":true,"set_number":"75192-1"}""",
            "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[{"id":1,"quantity":2}]}""",
            "/api/v1/alerts" to """{"success":true,"alerts":[]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true,"alert":{"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":450.0}}""",
        )
        t = TestDienste(pfade.imTakt(), io = Dispatchers.Main)
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

    private fun geladen(vm: SetDetailViewModel) = assertTrue("Detail geladen", vm.setDetailState.value.setDetail != null && vm.setDetailState.value.acquisitions.isNotEmpty())

    @Test
    fun `das Set kommt aus dem SavedStateHandle und alles wird dafuer geladen`() {
        val vm = vm()
        assertEquals("75192-1", vm.setNumber)
        vm.ladeAlles()
        geladen(vm)
        // Die Alarme kommen über die Übersicht des Kontos in die Ablage, nicht je Set.
        assertTrue("alle fünf Abrufe", listOf("/75192-1/price-history", "/75192-1/price?", "GET /api/v1/alerts").all { p -> pfade.anfragen.any { p.removeSuffix("?") in it } })
        assertEquals("Falke", vm.setDetailState.value.setDetail?.name)
    }

    @Test
    fun `eine geaenderte Menge steht sofort da und in der Ablage`() {
        runBlocking { t.ablage.uebernimm(Faecher.SETS, listOf(SetItem("75192-1", quantity = 1))) }
        val vm = vm()
        vm.ladeAlles()
        geladen(vm)
        serverHatDanachDrei()
        // Gewünscht 5, der Server deckelt auf 3 (fremde Exemplare lassen sich
        // nicht wegnehmen): Es gilt seine Zahl, nicht die eigene Annahme.
        vm.updateQuantity("75192-1", 5)
        assertTrue("Menge da", vm.setDetailState.value.setDetail?.quantity == 3)
        val abgelegt = runBlocking { t.sets().beobachteSets().first().liste.single() }
        assertEquals("die Galerie liest dieselbe Zahl aus der Ablage", 3, abgelegt.quantity)
        assertTrue(pfade.anfragenAn("PUT /api/v1/sets/75192-1").isNotEmpty())
    }

    @Test
    fun `der Regler schickt einen Schritt, keine Zielzahl`() {
        val vm = vm()
        vm.ladeAlles()
        geladen(vm)
        serverHatDanachDrei()
        vm.aendereMengeUm("75192-1", -1)
        assertTrue("PUT gesendet", pfade.anfragenAn("PUT /api/v1/sets/75192-1").isNotEmpty())
        val i = pfade.anfragen.indexOfFirst { "PUT /api/v1/sets/75192-1" in it }
        val rumpf = pfade.koerper[i]
        assertTrue(rumpf, "\"quantity_delta\":-1" in rumpf)
        assertTrue(rumpf, "\"quantity\":" !in rumpf)
        assertTrue("Menge vom Server", vm.setDetailState.value.setDetail?.quantity == 3)
    }

    @Test
    fun `ein geaenderter Kauf eines anderen Sets laedt hier nichts, einer dieses Sets schon`() {
        runBlocking { t.ablage.uebernimm(Faecher.SETS, listOf(SetItem("75192-1"), SetItem("10294-1"))) }
        val vm = vm()
        vm.ladeAlles()
        geladen(vm)
        val vorher = pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size

        // So schreibt KaeufeViewModel die Zusammenfassung des Servers in die Ablage.
        runBlocking { t.sets().uebernimmZusammenfassung(SetAggregate(setNumber = "10294-1", usedCount = 1)) }
        assertEquals(vorher, pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size)

        runBlocking { t.sets().uebernimmZusammenfassung(SetAggregate(setNumber = "75192-1", usedCount = 1)) }
        assertTrue("neu geladen", pfade.anfragenAn("GET /api/v1/sets/75192-1/acquisitions").size > vorher)
    }

    @Test
    fun `ein gespeicherter Preisalarm wird neu geladen`() {
        val vm = vm()
        vm.ladeAlles()
        geladen(vm)
        assertTrue(vm.setDetailState.value.preisalarme.isEmpty())
        val vorher = pfade.anfragenAn("GET /api/v1/alerts").size
        vm.setzePreisalarm("75192-1", Alarmrichtung.UNTER, "450", Zustand.NEU)
        pfade.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[{"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":450.0}]}"""
        uhr.advanceTimeBy(900)
        assertEquals(1, pfade.anfragenAn("PUT /api/v1/sets/75192-1/alert").size)
        // Der Zustand liest die Ablage nur beim Laden: ohne Nachladen bliebe er leer.
        assertTrue("neu geladen", pfade.anfragenAn("GET /api/v1/alerts").size > vorher)
        assertEquals(listOf(450.0), vm.setDetailState.value.preisalarme.map { it.schwelle })
    }
}
