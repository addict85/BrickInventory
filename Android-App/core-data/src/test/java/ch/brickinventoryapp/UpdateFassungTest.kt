package ch.brickinventoryapp

import ch.brickinventoryapp.util.fassungPasst
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Das geladene APK muss die Fassung tragen, die version.json ankündigt, und
 * neuer sein als die laufende App.
 *
 * Gegenprobe (01.11.2026, gemessen mit kotlinc lokal): in fassungPasst() den
 * Vergleich `imApk == gemeldet` entfernt → rot „ein APK mit anderer Fassung
 * als angekuendigt passt nicht“.
 */
class UpdateFassungTest {

    @Test
    fun `die angekuendigte, neuere Fassung passt`() {
        assertTrue(fassungPasst(200_000_120L, gemeldet = 200_000_120, laufend = 200_000_100))
    }

    @Test
    fun `ein APK mit anderer Fassung als angekuendigt passt nicht`() {
        assertFalse("Älter als angekündigt", fassungPasst(200_000_110L, gemeldet = 200_000_120, laufend = 200_000_100))
        assertFalse("Gleich der laufenden", fassungPasst(200_000_100L, gemeldet = 200_000_100, laufend = 200_000_100))
        assertFalse("Unlesbar", fassungPasst(null, gemeldet = 200_000_120, laufend = 200_000_100))
    }
}
