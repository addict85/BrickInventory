package ch.brickinventoryapp.zustand

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.testing.withRepo

/**
 * Das Design des Servers steht schon vor der Anmeldung fest.
 */
class DesignBeforeLoginTest {

    /**
     * Die Abfrage gegen einen Testserver; das Einbinden ins AppViewModel führt
     * AppViewModelTest aus. Gegenprobe: `@GET("api/v1/settings/theme")`
     * auf "…/design" → rot.
     */
    @Test
    fun `Stufe zwei - die oeffentliche Adresse wird gerufen`() {
        withRepo(::testAccountRepository) { paths, admin ->
            runBlocking { admin.getAppTheme() }
            assertEquals(listOf("GET /api/v1/settings/theme"), paths.requests.toList())
        }
    }
}

/**
 * Die Ueberwachung kann den Cache nicht nur ANSEHEN.
 */
class CacheClearTest {

    /**
     * Gegen einen Testserver. Gegenprobe: in
     * ManagementRepository.clearCache immer `emptyMap()` → rot.
     */
    @Test
    fun `die App kennt die Adresse und beide Umfaenge`() = withRepo(::testManagementRepository) { paths, admin ->
        runBlocking {
            admin.clearCache(alles = false)
            admin.clearCache(alles = true)
        }
        assertEquals(listOf("POST /api/v1/admin/cache-clear", "POST /api/v1/admin/cache-clear"), paths.requests.toList())
        assertEquals("Der Umfang (nur Preise / alles) wird nicht unterschieden",
            listOf("{}", """{"all":true}"""), paths.koerper.toList())
    }
}
