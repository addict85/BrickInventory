package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.ui.CategoryGerman
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Part categories in German like the colors next to them: words translated, commas and
 * hyphens stay, unknown words stand there in English.
 *
 * Counter-check: in uebersetze() the dictionary not
 * asked (`val de = wort`) → red “known categories …” („Bricks“ instead of „Steine“).
 */
class CategoryGermanTest {

    @Test
    fun `known categories read in German`() {
        assertEquals("Steine", CategoryGerman.translate("Bricks"))
        assertEquals("Steine schräg", CategoryGerman.translate("Bricks Sloped"))
        assertEquals("Stangen, Leitern und Zäune", CategoryGerman.translate("Bars, Ladders and Fences"))
        assertEquals("Fahrzeuge - Land", CategoryGerman.translate("Transportation - Land"))
        assertEquals("Minifigur Oberkörper", CategoryGerman.translate("Minifig Upper Body"))
    }

    @Test
    fun `unknown words stay`() {
        assertEquals("Bionicle", CategoryGerman.translate("Bionicle"))
        assertEquals("Zahnräder Zubehör", CategoryGerman.translate("Gears Accessories"))
    }
}
