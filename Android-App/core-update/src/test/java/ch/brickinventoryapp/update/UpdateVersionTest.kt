package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.versionFits
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The loaded APK must carry the version version.json announces, and
 * be newer than the running app.
 *
 * Counter-check: the comparison `inApk == reported` removed from
 * versionFits() → red „ein APK mit anderer Fassung
 * als angekuendigt passt nicht“.
 */
class UpdateVersionTest {

    @Test
    fun `the announced, newer version matches`() {
        assertTrue(versionFits(200_000_120L, reported = 200_000_120, running = 200_000_100))
    }

    @Test
    fun `an APK with a different version than announced does not match`() {
        assertFalse("Älter als angekündigt", versionFits(200_000_110L, reported = 200_000_120, running = 200_000_100))
        assertFalse("Gleich der laufenden", versionFits(200_000_100L, reported = 200_000_100, running = 200_000_100))
        assertFalse("Unlesbar", versionFits(null, reported = 200_000_120, running = 200_000_100))
    }
}
