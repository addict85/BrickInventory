package ch.brickinventoryapp.netz

import ch.brickinventoryapp.netz.util.VersionsHinweis
import ch.brickinventoryapp.netz.util.versionsHinweis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Who has to update? The server names its own contract version and the
 * smallest app version it still works with; the app compares against its own.
 *
 * Gegenprobe (measured 27.10. with kotlinc): swapped the two branches in
 * versionsHinweis → red: "eine zu alte App" and "ein zu alter Server".
 */
class ApiVersionTest {

    @Test
    fun `eine zu alte App`() {
        assertEquals(VersionsHinweis.APP_ZU_ALT, versionsHinweis(serverApi = 3, minApp = 2, appApi = 1))
    }

    @Test
    fun `ein zu alter Server`() {
        assertEquals(VersionsHinweis.SERVER_ZU_ALT, versionsHinweis(serverApi = 1, minApp = 1, appApi = 2))
    }

    @Test
    fun `passt, oder der Server sagt nichts`() {
        assertNull(versionsHinweis(serverApi = 1, minApp = 1, appApi = 1))
        assertNull(versionsHinweis(serverApi = 2, minApp = 1, appApi = 1))
        assertNull("Ältere Server senden keine Kopfzeile", versionsHinweis(serverApi = null, minApp = null, appApi = 1))
    }
}
