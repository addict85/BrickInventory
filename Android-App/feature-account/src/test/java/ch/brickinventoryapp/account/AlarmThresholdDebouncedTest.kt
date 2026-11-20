package ch.brickinventoryapp.account

import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
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
 * gemessen): in setAlarmThreshold() den wartenden Auftrag nicht abgebrochen → rot
 * „getippte Schwelle speichert nach der Ruhezeit einmal“ (zwei PUT, auch „4“).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlarmThresholdDebouncedTest {

    private val clock = TestCoroutineScheduler()
    private lateinit var paths: PfadServer
    private lateinit var t: TestDienste

    private val noReader = object : FileReader { override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null }

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher(clock))
        paths = PfadServer(
            "/api/v1/alerts" to """{"success":true,"alerts":[{"set_number":"75192-1","condition":"N","threshold":500.0}]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true}""",
        )
        t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
    }

    @After
    fun zu() {
        t.aufraeumen()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `getippte Schwelle speichert nach der Ruhezeit einmal, die letzte`() {
        val vm = t.merke(SettingsViewModel(t.sitzung, t.filter(), t.hinweise, t.sync, testAccountRepository(t.api),
            testManagementRepository(t.api), t.alerts(),
            testPartsRepository(t.api), noReader))
        vm.setAlarmThreshold("75192-1", Zustand.NEU, Alarmrichtung.UNTER, "4")
        vm.setAlarmThreshold("75192-1", Zustand.NEU, Alarmrichtung.UNTER, "449,90")
        clock.advanceTimeBy(500)
        assertTrue("Vor der Ruhezeit nichts gesendet", paths.requestsAn("PUT /api/v1/sets/75192-1/alert").isEmpty())
        clock.advanceTimeBy(500)
        assertTrue("gespeichert", paths.requestsAn("PUT /api/v1/sets/75192-1/alert").isNotEmpty())
        val puts = synchronized(paths.requests) {
            paths.requests.indices.filter { paths.requests[it] == "PUT /api/v1/sets/75192-1/alert" }.map { paths.koerper[it] }
        }
        assertEquals("Genau eine Anfrage: $puts", 1, puts.size)
        assertTrue("Mit dem letzten Wert: ${puts.single()}", "449.9" in puts.single())
    }
}
