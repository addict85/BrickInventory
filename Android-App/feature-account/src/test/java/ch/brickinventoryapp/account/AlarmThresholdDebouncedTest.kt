package ch.brickinventoryapp.account

import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
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
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.TestServices

/**
 * The price-alert overview saves on typing like the set and watchlist detail,
 * debounced in the ViewModel: one request with the last value, only after the quiet period.
 *
 * Counter-check (counter-checks/alarmschwelle-ohne-entprellung.patch, measured only in
 * CI): in setAlarmThreshold() the pending job not canceled → red
 * "getippte Schwelle speichert nach der Ruhezeit einmal" (two PUTs, "4" included).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlarmThresholdDebouncedTest {

    private val clock = TestCoroutineScheduler()
    private lateinit var paths: PathServer
    private lateinit var t: TestServices

    private val noReader = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher(clock))
        paths = PathServer(
            "/api/v1/alerts" to """{"success":true,"alerts":[{"set_number":"75192-1","condition":"N","threshold":500.0}]}""",
            "/api/v1/sets/75192-1/alert" to """{"success":true}""",
        )
        t = TestServices(paths.onTick(), io = Dispatchers.Main)
    }

    @After
    fun tearDown() {
        t.cleanUp()
        Dispatchers.resetMain()
        paths.server.shutdown()
    }

    @Test
    fun `a typed threshold saves once after the quiet period, the last one`() {
        val vm = t.track(SettingsViewModel(t.session, t.filter(), t.hints, t.sync, testAccountRepository(t.api),
            testManagementRepository(t.api), t.alerts(),
            testPartsRepository(t.api), noReader))
        vm.setAlarmThreshold("75192-1", Condition.NEW, AlarmDirection.BELOW, "4")
        vm.setAlarmThreshold("75192-1", Condition.NEW, AlarmDirection.BELOW, "449,90")
        clock.advanceTimeBy(500)
        assertTrue("Vor der Ruhezeit nichts gesendet", paths.requestsTo("PUT /api/v1/sets/75192-1/alert").isEmpty())
        clock.advanceTimeBy(500)
        assertTrue("gespeichert", paths.requestsTo("PUT /api/v1/sets/75192-1/alert").isNotEmpty())
        val puts = synchronized(paths.requests) {
            paths.requests.indices.filter { paths.requests[it] == "PUT /api/v1/sets/75192-1/alert" }.map { paths.bodyBytes[it] }
        }
        assertEquals("Genau eine Anfrage: $puts", 1, puts.size)
        assertTrue("Mit dem letzten Wert: ${puts.single()}", "449.9" in puts.single())
    }
}
