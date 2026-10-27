package ch.brickinventoryapp

import ch.brickinventoryapp.util.VersionsHinweis
import ch.brickinventoryapp.util.versionsHinweis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Wer muss aktualisieren? Der Server nennt seine Schnittstellenfassung und die
 * kleinste App-Fassung, mit der er arbeitet; die App vergleicht mit ihrer.
 *
 * Gegenprobe (am 27.10. mit kotlinc gemessen): in versionsHinweis die beiden
 * Zweige vertauscht → rot: „eine zu alte App" und „ein zu alter Server".
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
