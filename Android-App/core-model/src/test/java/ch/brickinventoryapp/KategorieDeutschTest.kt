package ch.brickinventoryapp

import ch.brickinventoryapp.ui.KategorieDeutsch
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Teilekategorien auf Deutsch wie die Farben daneben: Wörter übersetzt, Kommas und
 * Bindestriche bleiben, unbekannte Wörter stehen englisch da.
 *
 * Gegenprobe: in uebersetze() das Wörterbuch nicht
 * gefragt (`val de = wort`) → rot „bekannte Kategorien …“ („Bricks“ statt „Steine“).
 */
class KategorieDeutschTest {

    @Test
    fun `bekannte Kategorien lesen sich deutsch`() {
        assertEquals("Steine", KategorieDeutsch.uebersetze("Bricks"))
        assertEquals("Steine schräg", KategorieDeutsch.uebersetze("Bricks Sloped"))
        assertEquals("Stangen, Leitern und Zäune", KategorieDeutsch.uebersetze("Bars, Ladders and Fences"))
        assertEquals("Fahrzeuge - Land", KategorieDeutsch.uebersetze("Transportation - Land"))
        assertEquals("Minifigur Oberkörper", KategorieDeutsch.uebersetze("Minifig Upper Body"))
    }

    @Test
    fun `unbekannte Woerter bleiben stehen`() {
        assertEquals("Bionicle", KategorieDeutsch.uebersetze("Bionicle"))
        assertEquals("Zahnräder Zubehör", KategorieDeutsch.uebersetze("Gears Accessories"))
    }
}
