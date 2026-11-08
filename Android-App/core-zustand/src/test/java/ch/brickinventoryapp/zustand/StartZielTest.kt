package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.zustand.ui.StartZiel
import ch.brickinventoryapp.zustand.ui.startZiel
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Wo die App beginnt. Wer noch eine http-Adresse gespeichert hat, landet in der
 * Einrichtung mit der Anleitung zu https, auch wenn ein Token da ist.
 *
 * Gegenprobe: in startZiel() die Bedingung
 * klartextAltbestand() entfernt → rot „eine alte http-Adresse führt in die
 * Einrichtung …“ (SAMMLUNG statt EINRICHTUNG).
 */
class StartZielTest {

    @Test
    fun `eine alte http-Adresse fuehrt in die Einrichtung, auch angemeldet`() {
        assertEquals(StartZiel.EINRICHTUNG, startZiel("http://nas:3000", angemeldet = true, entwicklung = false))
        assertEquals(StartZiel.EINRICHTUNG, startZiel("http://192.168.1.50:3000", angemeldet = false, entwicklung = false))
        assertEquals("Auch der Debug-Build nur zum Gerät und Emulator",
            StartZiel.EINRICHTUNG, startZiel("http://nas:3000", angemeldet = true, entwicklung = true))
    }

    @Test
    fun `mit https geht es wie bisher weiter`() {
        assertEquals(StartZiel.EINRICHTUNG, startZiel("", angemeldet = false, entwicklung = false))
        assertEquals(StartZiel.ANMELDUNG, startZiel("https://brick.fritz.box", angemeldet = false, entwicklung = false))
        assertEquals(StartZiel.SAMMLUNG, startZiel("https://brick.fritz.box", angemeldet = true, entwicklung = false))
        assertEquals(StartZiel.SAMMLUNG, startZiel("http://10.0.2.2:3000", angemeldet = true, entwicklung = true))
    }
}
