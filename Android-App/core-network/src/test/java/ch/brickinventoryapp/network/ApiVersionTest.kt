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
 * Counter-check (measured 27.10. with kotlinc): swapped the two branches in
 * versionsHint → red: “a too old app” and “a too old server”.
 */
class ApiVersionTest {

    @Test
    fun `a too old app`() {
        assertEquals(VersionsHint.APP_TOO_OLD, versionsHint(serverApi = 3, minApp = 2, appApi = 1))
    }

    @Test
    fun `a too old server`() {
        assertEquals(VersionsHint.SERVER_TO_OLD, versionsHint(serverApi = 1, minApp = 1, appApi = 2))
    }

    @Test
    fun `fits, or the server says nothing`() {
        assertNull(versionsHint(serverApi = 1, minApp = 1, appApi = 1))
        assertNull(versionsHint(serverApi = 2, minApp = 1, appApi = 1))
        assertNull("Ältere Server senden keine Kopfzeile", versionsHint(serverApi = null, minApp = null, appApi = 1))
    }
}
