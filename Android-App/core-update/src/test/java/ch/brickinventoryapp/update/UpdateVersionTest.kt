package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.versionFits
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Das geladene APK muss die Fassung tragen, die version.json ankündigt, und
 * neuer sein als die laufende App.
 *
 * Gegenprobe: in versionFits() den
 * Vergleich `inApk == gemeldet` entfernt → rot „ein APK mit anderer Fassung
 * als angekuendigt passt nicht“.
 */
class UpdateVersionTest {

    @Test
    fun `the announced, newer version matches`() {
        assertTrue(versionFits(200_000_120L, gemeldet = 200_000_120, laufend = 200_000_100))
    }

    @Test
    fun `an APK with a different version than announced does not match`() {
        assertFalse("Älter als angekündigt", versionFits(200_000_110L, gemeldet = 200_000_120, laufend = 200_000_100))
        assertFalse("Gleich der laufenden", versionFits(200_000_100L, gemeldet = 200_000_100, laufend = 200_000_100))
        assertFalse("Unlesbar", versionFits(null, gemeldet = 200_000_120, laufend = 200_000_100))
    }
}
