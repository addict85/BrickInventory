package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.ui.CategoryGerman
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Teilekategorien auf Deutsch wie die Farben daneben: Wörter übersetzt, Kommas und
 * Bindestriche bleiben, unbekannte Wörter stehen englisch da.
 *
 * Gegenprobe: in uebersetze() das Wörterbuch nicht
 * gefragt (`val de = wort`) → rot „bekannte Kategorien …“ („Bricks“ statt „Steine“).
 */
class CategoryGermanTest {

    @Test
    fun `bekannte Kategorien lesen sich deutsch`() {
        assertEquals("Steine", CategoryGerman.translate("Bricks"))
        assertEquals("Steine schräg", CategoryGerman.translate("Bricks Sloped"))
        assertEquals("Stangen, Leitern und Zäune", CategoryGerman.translate("Bars, Ladders and Fences"))
        assertEquals("Fahrzeuge - Land", CategoryGerman.translate("Transportation - Land"))
        assertEquals("Minifigur Oberkörper", CategoryGerman.translate("Minifig Upper Body"))
    }

    @Test
    fun `unbekannte Woerter bleiben stehen`() {
        assertEquals("Bionicle", CategoryGerman.translate("Bionicle"))
        assertEquals("Zahnräder Zubehör", CategoryGerman.translate("Gears Accessories"))
    }
}
