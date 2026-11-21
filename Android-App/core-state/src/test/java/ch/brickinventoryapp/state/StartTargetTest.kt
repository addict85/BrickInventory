package ch.brickinventoryapp.state

import ch.brickinventoryapp.state.ui.StartTarget
import ch.brickinventoryapp.state.ui.startTarget
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Wo die App beginnt. Wer noch eine http-Adresse gespeichert hat, landet in der
 * Einrichtung mit der Anleitung zu https, auch wenn ein Token da ist.
 *
 * Gegenprobe: in startTarget() die Bedingung
 * plaintextLegacyStock() entfernt → rot „eine alte http-Adresse führt in die
 * Einrichtung …“ (SAMMLUNG statt EINRICHTUNG).
 */
class StartTargetTest {

    @Test
    fun `an old http address leads into the setup, even signed in`() {
        assertEquals(StartTarget.EINRICHTUNG, startTarget("http://nas:3000", angemeldet = true, entwicklung = false))
        assertEquals(StartTarget.EINRICHTUNG, startTarget("http://192.168.1.50:3000", angemeldet = false, entwicklung = false))
        assertEquals("Auch der Debug-Build nur zum Gerät und Emulator",
            StartTarget.EINRICHTUNG, startTarget("http://nas:3000", angemeldet = true, entwicklung = true))
    }

    @Test
    fun `with https it continues as before`() {
        assertEquals(StartTarget.EINRICHTUNG, startTarget("", angemeldet = false, entwicklung = false))
        assertEquals(StartTarget.LOGIN, startTarget("https://brick.fritz.box", angemeldet = false, entwicklung = false))
        assertEquals(StartTarget.SAMMLUNG, startTarget("https://brick.fritz.box", angemeldet = true, entwicklung = false))
        assertEquals(StartTarget.SAMMLUNG, startTarget("http://10.0.2.2:3000", angemeldet = true, entwicklung = true))
    }
}
