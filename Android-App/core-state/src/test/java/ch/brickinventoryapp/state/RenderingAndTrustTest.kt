package ch.brickinventoryapp.state

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.data.Vertrauensablage
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.state.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.state.ui.viewmodel.VertrauenViewModel
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.CertificateQuestion
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
import ch.brickinventoryapp.session.StoreAccountValues

/**
 * DarstellungViewModel and VertrauenViewModel put to the test, with in-memory stores
 * instead of PreferencesManager and in virtual time.
 *
 * Counter-checks:
 *   design-spaet-gesetzt        StoreAccountValues starts with the default instead of the remembered theme → red „der Zustand wird mit …“
 *   widget-nicht-angestossen    `widget.refresh()` removed → red „eine Wahl wird gemerkt …“
 *   vertrauen-ohne-abwurf       after trustCertificate() no `drop.discard()` → red „ein bestätigter …“
 *   unbekannte-ca-ohne-abtippen in CertificateQuestion.bestaetige() the typing-in requirement removed → red „ohne bekannte CA …“
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
    fun `the state is born with the remembered design`() = runTest(takt) {
        val ablage = StorageRendering().apply { design = Design.NOPPE }
        val konto = StorageSessionStore().apply { design.value = Design.NOPPE }
        // As on the device: currency and theme from the store, the first from the synchronous mirror.
        val sitzung = Sitzung(StoreAccountValues(konto, ablage, backgroundScope))
        val vm = DarstellungViewModel(ablage, sitzung) {}
        // Without a single tick of the clock: the first frame already shows the remembered theme.
        assertEquals(Design.NOPPE, vm.appTheme.value)
        assertEquals(Design.NOPPE, sitzung.state.value.appTheme)
        vm.viewModelScope.cancel()
    }

    @Test
    fun `a choice is remembered and applies immediately, the widget learns of its values`() = runTest(takt) {
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
    fun `a confirmed first contact remembers the pin and discards the open connections`() {
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
    fun `without a known CA only the typed fingerprint counts, discarding remembers nothing`() {
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
    fun `user CAs only after confirmation, every change discards the connections`() {
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
