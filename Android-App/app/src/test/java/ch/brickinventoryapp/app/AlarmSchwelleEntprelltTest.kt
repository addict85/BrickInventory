package ch.brickinventoryapp.app

import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.testing.VerwaltungRepository
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenViewModel
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
 * Die Preisalarm-Übersicht speichert wie Set- und Merkposten-Detail beim Tippen,
 * entprellt im ViewModel: eine Anfrage mit dem letzten Wert, erst nach der Ruhezeit.
 *
 * Gegenprobe (gegenproben/alarmschwelle-ohne-entprellung.patch, nur in der CI
 * gemessen): in setzeAlarmSchwelle() den wartenden Auftrag nicht abgebrochen → rot
 * „getippte Schwelle speichert nach der Ruhezeit einmal“ (zwei PUT, auch „4“).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlarmSchwelleEntprelltTest {

    private val uhr = TestCoroutineScheduler()
    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste

    private val keinLeser = object : DateiLeser { override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null }

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(uhr))
        pfade = PfadServer(
            "/api/v1/alerts" to """{"success":true,"alerts":[{"set_number":"75192-1","condition":"N","schwelle":500.0}]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true}""",
        )
        t = TestDienste(pfade.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        pfade.server.shutdown()
    }

    @Test
    fun `getippte Schwelle speichert nach der Ruhezeit einmal, die letzte`() {
        val vm = t.merke(EinstellungenViewModel(t.sitzung, t.filter(), t.hinweise, t.bestand, KontoRepository(t.api, t.cache),
            VerwaltungRepository(t.api, t.cache), SetsRepository(t.api, t.cache), TeileRepository(t.api, t.cache), keinLeser))
        vm.setzeAlarmSchwelle("75192-1", "N", "unter", "4")
        vm.setzeAlarmSchwelle("75192-1", "N", "unter", "449,90")
        uhr.advanceTimeBy(500)
        assertTrue("Vor der Ruhezeit nichts gesendet", pfade.anfragenAn("PUT /api/v1/sets/75192-1/alert").isEmpty())
        uhr.advanceTimeBy(500)
        assertTrue("gespeichert", pfade.anfragenAn("PUT /api/v1/sets/75192-1/alert").isNotEmpty())
        val puts = synchronized(pfade.anfragen) {
            pfade.anfragen.indices.filter { pfade.anfragen[it] == "PUT /api/v1/sets/75192-1/alert" }.map { pfade.koerper[it] }
        }
        assertEquals("Genau eine Anfrage: $puts", 1, puts.size)
        assertTrue("Mit dem letzten Wert: ${puts.single()}", "449.9" in puts.single())
    }
}
