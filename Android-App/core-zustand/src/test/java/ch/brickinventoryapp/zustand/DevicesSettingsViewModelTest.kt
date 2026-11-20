package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.ui.Meldung
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import org.junit.Assert.assertTrue
import ch.brickinventoryapp.sicherheit.StoreCipher
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.AlarmPlanner
import ch.brickinventoryapp.data.DevicesSettings
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.VorwaermNetwork
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.viewmodel.GeraeteEinstellungenViewModel
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
 * Der Alarmschalter und die Vorwärm-Netze schreiben über das ViewModel: Der Wunsch
 * wird gespeichert, der Alarm eingeplant, und ein Fehlschlag beim Einplanen kommt
 * mit Klasse und Meldung in den Meldungskanal.
 *
 * Gegenproben (gegenproben/, lokal mit Attrappen gemessen):
 *   geraet-alarm-nicht-eingeplant  alarmMessages() plant nicht ein
 *                                  → rot „der Schalter speichert und plant ein“
 *   geraet-fehler-verschluckt      der Fehler des Einplanens geht nicht in den Kanal
 *                                  → rot „ein Fehlschlag beim Einplanen wird gemeldet“
 *   geraet-ablage-nicht-geleert    clearStore() leert die Vorschau-Ablage nicht
 *                                  → rot „die Vorschau-Ablage laesst sich sehen und leeren“
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
    fun `der Schalter speichert und plant ein`() {
        vm.alarmMessages(true)
        assertEquals(true, vm.alarmMessagesAn.value)
        vm.alarmMessages(false)
        assertEquals(false, vm.alarmMessagesAn.value)
        assertEquals(listOf(true, false), planner.auftraege)
        assertNull("Ohne Fehlschlag keine Meldung", kanal.text)
    }

    @Test
    fun `ein Fehlschlag beim Einplanen wird gemeldet`() {
        planner.fehler = IllegalStateException("WorkManager fehlt")
        vm.alarmMessages(true)
        assertEquals("Der Wunsch gilt trotzdem", true, vm.alarmMessagesAn.value)
        assertEquals(Meldung.Resource(R.string.alert_schedule_failed, listOf("IllegalStateException: WorkManager fehlt")),
            kanal.meldung.value)
    }

    @Test
    fun `die Netze lassen sich einzeln einstellen`() {
        assertEquals(GeraeteEinstellungenViewModel.WARM_UP_DEFAULT, vm.vorwaermen.value)
        vm.vorwaermen(VorwaermNetwork.ROAMING, true)
        vm.vorwaermen(VorwaermNetwork.WLAN, false)
        assertEquals(mapOf(VorwaermNetwork.WLAN to false, VorwaermNetwork.MOBILE to false, VorwaermNetwork.ROAMING to true),
            vm.vorwaermen.value)
    }

    @Test
    fun `die Vorschau-Ablage laesst sich sehen und leeren`() {
        assertTrue("Die belegte Ablage zeigt keine Bytes", vm.storeBytes.value > 0)
        vm.clearStore()
        assertEquals(0L, vm.storeBytes.value)
        assertEquals(0L, vorschau.belegt())
        assertEquals(Meldung.Resource(R.string.monitoring_cache_saved), kanal.meldung.value)
    }
}
