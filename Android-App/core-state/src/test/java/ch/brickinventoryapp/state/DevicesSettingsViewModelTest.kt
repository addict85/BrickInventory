package ch.brickinventoryapp.state

import ch.brickinventoryapp.model.ui.Meldung
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import org.junit.Assert.assertTrue
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.AlarmPlanner
import ch.brickinventoryapp.data.DevicesSettings
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.VorwaermNetwork
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.GeraeteEinstellungenViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.nio.file.Files
import ch.brickinventoryapp.testing.text

/**
 * The alert switch and the warm-up networks write via the ViewModel: the wish
 * is stored, the alert scheduled, and a scheduling failure comes
 * with class and message into the notification channel.
 *
 * Counter-checks (gegenproben/, measured locally with fakes):
 *   geraet-alarm-nicht-eingeplant  alarmMessages() doesn't schedule
 *                                  → red „the switch saves and schedules“
 *   geraet-fehler-verschluckt      the scheduling error doesn't go into the channel
 *                                  → red „a failure when scheduling is reported“
 *   geraet-ablage-nicht-geleert    clearStore() doesn't clear the preview store
 *                                  → red „the preview store can be viewed and cleared“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DevicesSettingsViewModelTest {

    private class Ablage : DevicesSettings {
        val alarm = MutableStateFlow(false)
        val networks = VorwaermNetwork.entries.associateWith { MutableStateFlow(it == VorwaermNetwork.WLAN) }
        override val alarmMessagesAn: Flow<Boolean> = alarm
        override suspend fun setAlarmMessages(an: Boolean) { alarm.value = an }
        override fun warmUpAllowed(netz: VorwaermNetwork): Flow<Boolean> = networks.getValue(netz)
        override suspend fun warmUpSet(netz: VorwaermNetwork, erlaubt: Boolean) { networks.getValue(netz).value = erlaubt }
    }

    private class Planner : AlarmPlanner {
        val auftraege = mutableListOf<Boolean>()
        var fehler: Throwable? = null
        override suspend fun einplanen(an: Boolean): Throwable? { auftraege += an; return fehler }
    }

    private val ablage = Ablage()
    private val planner = Planner()
    private val kanal = MeldungsKanal()
    private val root = Files.createTempDirectory("vorschau").toFile()
    private val vorschau = VorschauSpeicher({ root }, StoreCipher { ByteArray(32) { 4 } }) { ByteArray(32) { 14 } }
    private lateinit var vm: GeraeteEinstellungenViewModel
    private lateinit var collector: Job

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        vorschau.schreibe("https://brick.example/api/v1/proxy?u=x&thumb=1", ByteArray(500) { 1 })
        vm = GeraeteEinstellungenViewModel(ablage, planner, kanal, vorschau)
        collector = CoroutineScope(Dispatchers.Main).launch {
            launch { vm.alarmMessagesAn.collect {} }
            launch { vm.vorwaermen.collect {} }
        }
    }

    @After
    fun zu() {
        collector.cancel()
        Dispatchers.resetMain()
        root.deleteRecursively()
    }

    @Test
    fun `the switch saves and schedules`() {
        vm.alarmMessages(true)
        assertEquals(true, vm.alarmMessagesAn.value)
        vm.alarmMessages(false)
        assertEquals(false, vm.alarmMessagesAn.value)
        assertEquals(listOf(true, false), planner.auftraege)
        assertNull("Ohne Fehlschlag keine Meldung", kanal.text)
    }

    @Test
    fun `a failure when scheduling is reported`() {
        planner.fehler = IllegalStateException("WorkManager fehlt")
        vm.alarmMessages(true)
        assertEquals("Der Wunsch gilt trotzdem", true, vm.alarmMessagesAn.value)
        assertEquals(Meldung.Resource(R.string.alert_schedule_failed, listOf("IllegalStateException: WorkManager fehlt")),
            kanal.meldung.value)
    }

    @Test
    fun `the networks can be set individually`() {
        assertEquals(GeraeteEinstellungenViewModel.WARM_UP_DEFAULT, vm.vorwaermen.value)
        vm.vorwaermen(VorwaermNetwork.ROAMING, true)
        vm.vorwaermen(VorwaermNetwork.WLAN, false)
        assertEquals(mapOf(VorwaermNetwork.WLAN to false, VorwaermNetwork.MOBILE to false, VorwaermNetwork.ROAMING to true),
            vm.vorwaermen.value)
    }

    @Test
    fun `the preview store can be viewed and cleared`() {
        assertTrue("Die belegte Ablage zeigt keine Bytes", vm.storeBytes.value > 0)
        vm.clearStore()
        assertEquals(0L, vm.storeBytes.value)
        assertEquals(0L, vorschau.belegt())
        assertEquals(Meldung.Resource(R.string.monitoring_cache_saved), kanal.meldung.value)
    }
}
