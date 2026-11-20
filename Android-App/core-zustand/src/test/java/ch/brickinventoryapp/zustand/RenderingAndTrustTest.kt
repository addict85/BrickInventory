package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.data.Vertrauensablage
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.VertrauenViewModel
import ch.brickinventoryapp.sicherheit.CertificateUnresolved
import ch.brickinventoryapp.sicherheit.CertificateQuestion
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.testing.StorageSessionStore
import ch.brickinventoryapp.sitzung.StoreAccountValues

/**
 * DarstellungViewModel und VertrauenViewModel ausgeführt, mit Ablagen im Speicher
 * statt PreferencesManager und in virtueller Zeit.
 *
 * Gegenproben:
 *   design-spaet-gesetzt        StoreAccountValues beginnt mit der Vorgabe statt dem gemerkten Design → rot „der Zustand wird mit …“
 *   widget-nicht-angestossen    `widget.refresh()` gestrichen → rot „eine Wahl wird gemerkt …“
 *   vertrauen-ohne-abwurf       nach trustCertificate() kein `drop.discard()` → rot „ein bestätigter …“
 *   unbekannte-ca-ohne-abtippen in CertificateQuestion.bestaetige() die Abtipp-Pflicht gestrichen → rot „ohne bekannte CA …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RenderingAndTrustTest {

    private val takt = StandardTestDispatcher()

    @Before fun auf() = Dispatchers.setMain(takt)

    @After fun ab() = Dispatchers.resetMain()

    private class StorageRendering : Darstellungsablage {
        var design = Design.CLASSIC
        var hell = "system"
        var farben = false
        var verbergen = true
        var widget = false
        var sprache = ""
        override fun rememberedDesign() = design
        override fun helligkeit() = hell
        override fun setzeHelligkeit(wahl: String) { hell = wahl }
        override fun systemfarben() = farben
        override fun setzeSystemfarben(an: Boolean) { farben = an }
        override fun hidePreview() = verbergen
        override fun setzeVorschauVerbergen(an: Boolean) { verbergen = an }
        override fun showWidgetValues() = widget
        override fun showSetWidgetValues(an: Boolean) { widget = an }
        override suspend fun saveLanguage(lang: String) { sprache = lang }
    }

    private class StorageTrust : Vertrauensablage {
        val pins = mutableMapOf<String, String>()
        var caOn = false
        override fun pin(schluessel: String) = pins[schluessel]
        override fun rememberPin(schluessel: String, fingerabdruck: String) { pins[schluessel] = fingerabdruck }
        override fun userCaAllowed() = caOn
        override fun setUserCa(an: Boolean) { caOn = an }
    }

    @Test
    fun `der Zustand wird mit dem gemerkten Design geboren`() = runTest(takt) {
        val ablage = StorageRendering().apply { design = Design.NOPPE }
        val konto = StorageSessionStore().apply { design.value = Design.NOPPE }
        // Wie im Gerät: Währung und Design aus der Ablage, das erste aus dem synchronen Spiegel.
        val sitzung = Sitzung(StoreAccountValues(konto, ablage, backgroundScope))
        val vm = DarstellungViewModel(ablage, sitzung) {}
        // Ohne einen Schritt des Takts: Das erste Bild zeigt schon das gemerkte Design.
        assertEquals(Design.NOPPE, vm.appTheme.value)
        assertEquals(Design.NOPPE, sitzung.state.value.appTheme)
        vm.viewModelScope.cancel()
    }

    @Test
    fun `eine Wahl wird gemerkt und gilt sofort, das Widget erfaehrt von seinen Werten`() = runTest(takt) {
        val ablage = StorageRendering()
        var widgetKicks = 0
        val vm = DarstellungViewModel(ablage, Sitzung()) { widgetKicks++ }
        assertTrue("Vorgabe: Vorschau verborgen", vm.hidePreview.value)

        vm.setHelligkeit("dunkel")
        vm.setSystemfarben(true)
        vm.setVorschauVerbergen(false)
        assertEquals("dunkel", ablage.hell)
        assertEquals("dunkel", vm.helligkeit.value)
        assertTrue(ablage.farben && vm.systemfarben.value)
        assertFalse(ablage.verbergen || vm.hidePreview.value)
        assertEquals("Andere Werte stossen das Widget nicht an", 0, widgetKicks)

        vm.setWidgetValues(true)
        advanceUntilIdle()
        assertTrue(ablage.widget && vm.widgetValues.value)
        assertEquals("Das Widget zeigt die neue Wahl erst nach einem Anstoss", 1, widgetKicks)
        vm.viewModelScope.cancel()
    }

    @Test
    fun `ein bestaetigter Erstkontakt merkt den Pin und verwirft die offenen Verbindungen`() {
        val frage = CertificateQuestion()
        val ablage = StorageTrust()
        var drops = 0
        val vm = VertrauenViewModel(ablage, { drops++ }, frage)
        frage.melde(CertificateUnresolved("brick.example:443", "AB:CD", CertificateUnresolved.Art.ERSTKONTAKT, ctForced = true))
        assertEquals("AB:CD", vm.zertifikat.value?.fingerabdruck)

        assertTrue(vm.trustCertificate())
        assertEquals("AB:CD", ablage.pins["brick.example:443"])
        assertEquals("Verbindungen mit dem alten Vertrauen bleiben offen", 1, drops)
        assertNull(vm.zertifikat.value)
        assertFalse("Ohne offene Frage nichts zu bestätigen", vm.trustCertificate())
        assertEquals(1, drops)
    }

    @Test
    fun `ohne bekannte CA zaehlt nur der abgetippte Fingerabdruck, Verwerfen merkt nichts`() {
        val frage = CertificateQuestion()
        val ablage = StorageTrust()
        var drops = 0
        val vm = VertrauenViewModel(ablage, { drops++ }, frage)
        val fp = "0123456789ABCDEF0123456789ABCDEF"
        frage.melde(CertificateUnresolved("brick.example:443", fp, CertificateUnresolved.Art.UNBEKANNTE_CA))

        assertFalse("Ein Tipp allein genügt nicht", vm.trustCertificate())
        assertFalse("Ein falscher Fingerabdruck genügt nicht", vm.trustCertificate("FFFFFFFFFFFF"))
        assertTrue(ablage.pins.isEmpty())
        assertEquals(0, drops)
        assertTrue(vm.trustCertificate(fp))
        assertEquals(fp, ablage.pins["brick.example:443"])
        assertEquals(1, drops)

        frage.melde(CertificateUnresolved("andere.example:443", "EE", CertificateUnresolved.Art.ERSTKONTAKT))
        vm.discardCertificate()
        assertNull(vm.zertifikat.value)
        assertNull(ablage.pins["andere.example:443"])
    }

    @Test
    fun `Nutzer-CAs nur nach Rueckfrage, jede Aenderung verwirft die Verbindungen`() {
        val ablage = StorageTrust()
        var drops = 0
        val vm = VertrauenViewModel(ablage, { drops++ }, CertificateQuestion())
        vm.userCa.requests()
        assertTrue(vm.userCa.frage.value)
        assertFalse("Erst die Bestätigung schaltet ein", ablage.caOn)
        vm.userCa.bestaetigen()
        assertTrue(ablage.caOn && vm.userCa.an.value)
        assertEquals(1, drops)
        vm.userCa.turnOff()
        assertFalse(ablage.caOn)
        assertEquals(2, drops)
    }
}
