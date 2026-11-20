package ch.brickinventoryapp.network

import ch.brickinventoryapp.network.util.VersionsHint
import ch.brickinventoryapp.network.util.versionsHint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Who has to update? The server names its own contract version and the
 * smallest app version it still works with; the app compares against its own.
 *
 * Gegenprobe (measured 27.10. with kotlinc): swapped the two branches in
 * versionsHint → red: "eine zu alte App" and "ein zu alter Server".
 */
class ApiVersionTest {

    @Test
    fun `eine zu alte App`() {
        assertEquals(VersionsHint.APP_ZU_ALT, versionsHint(serverApi = 3, minApp = 2, appApi = 1))
    }

    @Test
    fun `ein zu alter Server`() {
        assertEquals(VersionsHint.SERVER_TO_ALT, versionsHint(serverApi = 1, minApp = 1, appApi = 2))
    }

    @Test
    fun `passt, oder der Server sagt nichts`() {
        assertNull(versionsHint(serverApi = 1, minApp = 1, appApi = 1))
        assertNull(versionsHint(serverApi = 2, minApp = 1, appApi = 1))
        assertNull("Ältere Server senden keine Kopfzeile", versionsHint(serverApi = null, minApp = null, appApi = 1))
    }
}
