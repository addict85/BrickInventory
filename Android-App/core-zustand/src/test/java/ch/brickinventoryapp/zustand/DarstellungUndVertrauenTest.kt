package ch.brickinventoryapp.zustand

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.data.Vertrauensablage
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.VertrauenViewModel
import ch.brickinventoryapp.sicherheit.ZertifikatUngeklaert
import ch.brickinventoryapp.sicherheit.ZertifikatsFrage
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

/**
 * DarstellungViewModel und VertrauenViewModel ausgeführt, mit Ablagen im Speicher
 * statt PreferencesManager und in virtueller Zeit.
 *
 * Gegenproben:
 *   design-spaet-gesetzt        `sitzung.setzeDesign(...)` aus dem init → rot „der Zustand wird mit …“
 *   widget-nicht-angestossen    `widget.aktualisiere()` gestrichen → rot „eine Wahl wird gemerkt …“
 *   vertrauen-ohne-abwurf       nach zertifikatVertrauen() kein `abwurf.verwirf()` → rot „ein bestätigter …“
 *   unbekannte-ca-ohne-abtippen in ZertifikatsFrage.bestaetige() die Abtipp-Pflicht gestrichen → rot „ohne bekannte CA …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DarstellungUndVertrauenTest {

    private val takt = StandardTestDispatcher()

    @Before fun auf() = Dispatchers.setMain(takt)

    @After fun ab() = Dispatchers.resetMain()

    private class SpeicherDarstellung : Darstellungsablage {
        var design = "classic"
        var hell = "system"
        var farben = false
        var verbergen = true
        var widget = false
        var sprache = ""
        override fun gemerktesDesign() = design
        override fun helligkeit() = hell
        override fun setzeHelligkeit(wahl: String) { hell = wahl }
        override fun systemfarben() = farben
        override fun setzeSystemfarben(an: Boolean) { farben = an }
        override fun vorschauVerbergen() = verbergen
        override fun setzeVorschauVerbergen(an: Boolean) { verbergen = an }
        override fun widgetWerteZeigen() = widget
        override fun setzeWidgetWerteZeigen(an: Boolean) { widget = an }
        override suspend fun saveLanguage(lang: String) { sprache = lang }
    }

    private class SpeicherVertrauen : Vertrauensablage {
        val pins = mutableMapOf<String, String>()
        var nutzerCa = false
        override fun pin(schluessel: String) = pins[schluessel]
        override fun merkePin(schluessel: String, fingerabdruck: String) { pins[schluessel] = fingerabdruck }
        override fun nutzerCaErlaubt() = nutzerCa
        override fun setzeNutzerCa(an: Boolean) { nutzerCa = an }
    }

    @Test
    fun `der Zustand wird mit dem gemerkten Design geboren`() = runTest(takt) {
        val ablage = SpeicherDarstellung().apply { design = "noppe" }
        val sitzung = Sitzung()
        val vm = DarstellungViewModel(ablage, sitzung) {}
        // Ohne einen Schritt des Takts: Das erste Bild zeigt schon das gemerkte Design.
        assertEquals("noppe", vm.appTheme.value)
        assertEquals("noppe", sitzung.state.value.appTheme)
        vm.viewModelScope.cancel()
    }

    @Test
    fun `eine Wahl wird gemerkt und gilt sofort, das Widget erfaehrt von seinen Werten`() = runTest(takt) {
        val ablage = SpeicherDarstellung()
        var widgetAnstoesse = 0
        val vm = DarstellungViewModel(ablage, Sitzung()) { widgetAnstoesse++ }
        assertTrue("Vorgabe: Vorschau verborgen", vm.vorschauVerbergen.value)

        vm.setHelligkeit("dunkel")
        vm.setSystemfarben(true)
        vm.setVorschauVerbergen(false)
        assertEquals("dunkel", ablage.hell)
        assertEquals("dunkel", vm.helligkeit.value)
        assertTrue(ablage.farben && vm.systemfarben.value)
        assertFalse(ablage.verbergen || vm.vorschauVerbergen.value)
        assertEquals("Andere Werte stossen das Widget nicht an", 0, widgetAnstoesse)

        vm.setWidgetWerte(true)
        advanceUntilIdle()
        assertTrue(ablage.widget && vm.widgetWerte.value)
        assertEquals("Das Widget zeigt die neue Wahl erst nach einem Anstoss", 1, widgetAnstoesse)
        vm.viewModelScope.cancel()
    }

    @Test
    fun `ein bestaetigter Erstkontakt merkt den Pin und verwirft die offenen Verbindungen`() {
        val frage = ZertifikatsFrage()
        val ablage = SpeicherVertrauen()
        var abwuerfe = 0
        val vm = VertrauenViewModel(ablage, { abwuerfe++ }, frage)
        frage.melde(ZertifikatUngeklaert("brick.example:443", "AB:CD", ZertifikatUngeklaert.Art.ERSTKONTAKT))
        assertEquals("AB:CD", vm.zertifikat.value?.fingerabdruck)

        assertTrue(vm.zertifikatVertrauen())
        assertEquals("AB:CD", ablage.pins["brick.example:443"])
        assertEquals("Verbindungen mit dem alten Vertrauen bleiben offen", 1, abwuerfe)
        assertNull(vm.zertifikat.value)
        assertFalse("Ohne offene Frage nichts zu bestätigen", vm.zertifikatVertrauen())
        assertEquals(1, abwuerfe)
    }

    @Test
    fun `ohne bekannte CA zaehlt nur der abgetippte Fingerabdruck, Verwerfen merkt nichts`() {
        val frage = ZertifikatsFrage()
        val ablage = SpeicherVertrauen()
        var abwuerfe = 0
        val vm = VertrauenViewModel(ablage, { abwuerfe++ }, frage)
        val fp = "0123456789ABCDEF0123456789ABCDEF"
        frage.melde(ZertifikatUngeklaert("brick.example:443", fp, ZertifikatUngeklaert.Art.UNBEKANNTE_CA))

        assertFalse("Ein Tipp allein genügt nicht", vm.zertifikatVertrauen())
        assertFalse("Ein falscher Fingerabdruck genügt nicht", vm.zertifikatVertrauen("FFFFFFFFFFFF"))
        assertTrue(ablage.pins.isEmpty())
        assertEquals(0, abwuerfe)
        assertTrue(vm.zertifikatVertrauen(fp))
        assertEquals(fp, ablage.pins["brick.example:443"])
        assertEquals(1, abwuerfe)

        frage.melde(ZertifikatUngeklaert("andere.example:443", "EE", ZertifikatUngeklaert.Art.ERSTKONTAKT))
        vm.zertifikatVerwerfen()
        assertNull(vm.zertifikat.value)
        assertNull(ablage.pins["andere.example:443"])
    }

    @Test
    fun `Nutzer-CAs nur nach Rueckfrage, jede Aenderung verwirft die Verbindungen`() {
        val ablage = SpeicherVertrauen()
        var abwuerfe = 0
        val vm = VertrauenViewModel(ablage, { abwuerfe++ }, ZertifikatsFrage())
        vm.nutzerCa.anfragen()
        assertTrue(vm.nutzerCa.frage.value)
        assertFalse("Erst die Bestätigung schaltet ein", ablage.nutzerCa)
        vm.nutzerCa.bestaetigen()
        assertTrue(ablage.nutzerCa && vm.nutzerCa.an.value)
        assertEquals(1, abwuerfe)
        vm.nutzerCa.ausschalten()
        assertFalse(ablage.nutzerCa)
        assertEquals(2, abwuerfe)
    }
}
