package ch.brickinventoryapp.state

import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.testing.withRepo
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The server's theme is already known before sign-in.
 */
class DesignBeforeLoginTest {

    /**
     * The query against a test server; wiring it into the AppViewModel is run by
     * AppViewModelTest. Counter-check: `@GET("api/v1/settings/theme")`
     * changed to "…/design" → red.
     */
    @Test
    fun `stage two - the public address is called`() {
        withRepo(::testAccountRepository) { paths, admin ->
            runBlocking { admin.getAppTheme() }
            assertEquals(listOf("GET /api/v1/settings/theme"), paths.requests.toList())
        }
    }
}

/**
 * Monitoring can't only LOOK AT the cache.
 */
class CacheClearTest {

    /**
     * Against a test server. Counter-check: in
     * ManagementRepository.clearCache always `emptyMap()` → red.
     */
    @Test
    fun `the app knows the address and both scopes`() = withRepo(::testManagementRepository) { paths, admin ->
        runBlocking {
            admin.clearCache(everything = false)
            admin.clearCache(everything = true)
        }
        assertEquals(listOf("POST /api/v1/admin/cache-clear", "POST /api/v1/admin/cache-clear"), paths.requests.toList())
        assertEquals("Der Umfang (nur Preise / alles) wird nicht unterschieden",
            listOf("{}", """{"all":true}"""), paths.bodyBytes.toList())
    }
}
