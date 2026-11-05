package ch.brickinventoryapp

import org.junit.Assert.assertTrue
import ch.brickinventoryapp.util.AblageChiffre
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.AlarmPlaner
import ch.brickinventoryapp.data.GeraeteEinstellungen
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.VorwaermNetz
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.viewmodel.GeraeteEinstellungenViewModel
import ch.brickinventoryapp.ui.viewmodel.Texte
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

/**
 * Der Alarmschalter und die Vorwärm-Netze schreiben über das ViewModel: Der Wunsch
 * wird gespeichert, der Alarm eingeplant, und ein Fehlschlag beim Einplanen kommt
 * mit Klasse und Meldung in den Meldungskanal.
 *
 * Gegenproben (gegenproben/, lokal mit Attrappen gemessen):
 *   geraet-alarm-nicht-eingeplant  alarmMeldungen() plant nicht ein
 *                                  → rot „der Schalter speichert und plant ein“
 *   geraet-fehler-verschluckt      der Fehler des Einplanens geht nicht in den Kanal
 *                                  → rot „ein Fehlschlag beim Einplanen wird gemeldet“
 *   geraet-ablage-nicht-geleert    ablageLeeren() leert die Vorschau-Ablage nicht
 *                                  → rot „die Vorschau-Ablage laesst sich sehen und leeren“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GeraeteEinstellungenViewModelTest {

    private class Ablage : GeraeteEinstellungen {
        val alarm = MutableStateFlow(false)
        val netze = VorwaermNetz.entries.associateWith { MutableStateFlow(it == VorwaermNetz.WLAN) }
        override val alarmMeldungenAn: Flow<Boolean> = alarm
        override suspend fun setzeAlarmMeldungen(an: Boolean) { alarm.value = an }
        override fun vorwaermenErlaubt(netz: VorwaermNetz): Flow<Boolean> = netze.getValue(netz)
        override suspend fun setzeVorwaermen(netz: VorwaermNetz, erlaubt: Boolean) { netze.getValue(netz).value = erlaubt }
    }

    private class Planer : AlarmPlaner {
        val auftraege = mutableListOf<Boolean>()
        var fehler: Throwable? = null
        override suspend fun einplanen(an: Boolean): Throwable? { auftraege += an; return fehler }
    }

    private object Saetze : Texte {
        override fun text(id: Int, vararg args: Any?) = "t$id(${args.joinToString()})"
        override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id"
        override fun meldung(fehler: Result.Error) = fehler.message
        override fun angemeldet() = true
    }

    private val ablage = Ablage()
    private val planer = Planer()
    private val kanal = MeldungsKanal()
    private val wurzel = java.nio.file.Files.createTempDirectory("vorschau").toFile()
    private val vorschau = VorschauSpeicher({ wurzel }, AblageChiffre { ByteArray(32) { 4 } })
    private lateinit var vm: GeraeteEinstellungenViewModel

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        vorschau.schreibe("https://brick.example/api/v1/proxy?u=x&thumb=1", ByteArray(500) { 1 })
        vm = GeraeteEinstellungenViewModel(ablage, planer, Saetze, kanal, vorschau)
    }

    @After
    fun zu() {
        Dispatchers.resetMain()
        wurzel.deleteRecursively()
    }

    @Test
    fun `der Schalter speichert und plant ein`() {
        vm.alarmMeldungen(true)
        assertEquals(true, vm.alarmMeldungenAn.value)
        vm.alarmMeldungen(false)
        assertEquals(false, vm.alarmMeldungenAn.value)
        assertEquals(listOf(true, false), planer.auftraege)
        assertNull("Ohne Fehlschlag keine Meldung", kanal.meldung.value)
    }

    @Test
    fun `ein Fehlschlag beim Einplanen wird gemeldet`() {
        planer.fehler = IllegalStateException("WorkManager fehlt")
        vm.alarmMeldungen(true)
        assertEquals("Der Wunsch gilt trotzdem", true, vm.alarmMeldungenAn.value)
        assertEquals("t${R.string.alert_schedule_failed}(IllegalStateException: WorkManager fehlt)", kanal.meldung.value)
    }

    @Test
    fun `die Netze lassen sich einzeln einstellen`() {
        assertEquals(GeraeteEinstellungenViewModel.VORWAERMEN_VORGABE, vm.vorwaermen.value)
        vm.vorwaermen(VorwaermNetz.ROAMING, true)
        vm.vorwaermen(VorwaermNetz.WLAN, false)
        assertEquals(mapOf(VorwaermNetz.WLAN to false, VorwaermNetz.MOBIL to false, VorwaermNetz.ROAMING to true),
            vm.vorwaermen.value)
    }

    @Test
    fun `die Vorschau-Ablage laesst sich sehen und leeren`() {
        assertTrue("Die belegte Ablage zeigt keine Bytes", vm.ablageBytes.value > 0)
        vm.ablageLeeren()
        assertEquals(0L, vm.ablageBytes.value)
        assertEquals(0L, vorschau.belegt())
        assertEquals("t${R.string.monitoring_cache_saved}()", kanal.meldung.value)
    }
}
