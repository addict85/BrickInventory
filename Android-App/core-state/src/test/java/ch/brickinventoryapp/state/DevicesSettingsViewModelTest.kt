package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.dataapi.device.AlarmPlanner
import ch.brickinventoryapp.dataapi.device.DevicesSettings
import ch.brickinventoryapp.dataapi.device.PrewarmNetwork
import ch.brickinventoryapp.dataapi.message.MessageChannel
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.state.ui.viewmodel.DevicesSettingsViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.nio.file.Files

/**
 * The alert switch and the warm-up networks write via the ViewModel: the wish
 * is stored, the alert scheduled, and a scheduling failure comes
 * with class and message into the notification channel.
 *
 * Counter-checks (counter-checks/, measured locally with fakes):
 *   device-alarm-not-scheduled  alarmMessages() doesn't schedule
 *                                  → red „the switch saves and schedules“
 *   device-error-swallowed      the scheduling error doesn't go into the channel
 *                                  → red „a failure when scheduling is reported“
 *   device-store-not-cleared    clearStore() doesn't clear the preview store
 *                                  → red „the preview store can be viewed and cleared“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DevicesSettingsViewModelTest {

    private class Store : DevicesSettings {
        val alarm = MutableStateFlow(false)
        val networks = PrewarmNetwork.entries.associateWith { MutableStateFlow(it == PrewarmNetwork.WIFI) }
        override val alarmMessagesEnabled: Flow<Boolean> = alarm
        override suspend fun setAlarmMessages(an: Boolean) { alarm.value = an }
        override fun warmUpAllowed(network: PrewarmNetwork): Flow<Boolean> = networks.getValue(network)
        override suspend fun warmUpSet(network: PrewarmNetwork, allowed: Boolean) { networks.getValue(network).value = allowed }
    }

    private class Planner : AlarmPlanner {
        val jobs = mutableListOf<Boolean>()
        var error: Throwable? = null
        override suspend fun schedule(an: Boolean): Throwable? { jobs += an; return error }
    }

    private val store = Store()
    private val planner = Planner()
    private val channel = MessageChannel()
    private val root = Files.createTempDirectory("vorschau").toFile()
    private val preview = PreviewMemory({ root }, StoreCipher { ByteArray(32) { 4 } }) { ByteArray(32) { 14 } }
    private lateinit var vm: DevicesSettingsViewModel
    private lateinit var collector: Job

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        preview.write("https://brick.example/api/v2/proxy?u=x&thumb=1", ByteArray(500) { 1 })
        vm = DevicesSettingsViewModel(store, planner, channel, preview)
        collector = CoroutineScope(Dispatchers.Main).launch {
            launch { vm.alarmMessagesEnabled.collect {} }
            launch { vm.prewarm.collect {} }
        }
    }

    @After
    fun tearDown() {
        collector.cancel()
        Dispatchers.resetMain()
        root.deleteRecursively()
    }

    @Test
    fun `the switch saves and schedules`() {
        vm.alarmMessages(true)
        assertEquals(true, vm.alarmMessagesEnabled.value)
        vm.alarmMessages(false)
        assertEquals(false, vm.alarmMessagesEnabled.value)
        assertEquals(listOf(true, false), planner.jobs)
        assertNull("no message without a failure", channel.text)
    }

    @Test
    fun `a failure when scheduling is reported`() {
        planner.error = IllegalStateException("WorkManager is missing")
        vm.alarmMessages(true)
        assertEquals("the wish counts anyway", true, vm.alarmMessagesEnabled.value)
        assertEquals(Message.Resource(R.string.alert_schedule_failed, listOf("IllegalStateException: WorkManager is missing")),
            channel.message.value)
    }

    @Test
    fun `the networks can be set individually`() {
        assertEquals(DevicesSettingsViewModel.WARM_UP_DEFAULT, vm.prewarm.value)
        vm.prewarm(PrewarmNetwork.ROAMING, true)
        vm.prewarm(PrewarmNetwork.WIFI, false)
        assertEquals(mapOf(PrewarmNetwork.WIFI to false, PrewarmNetwork.MOBILE to false, PrewarmNetwork.ROAMING to true),
            vm.prewarm.value)
    }

    @Test
    fun `the preview store can be viewed and cleared`() {
        assertTrue("the occupied store shows no bytes", vm.storeBytes.value > 0)
        vm.clearStore()
        assertEquals(0L, vm.storeBytes.value)
        assertEquals(0L, preview.occupied())
        assertEquals(Message.Resource(R.string.monitoring_cache_saved), channel.message.value)
    }
}
