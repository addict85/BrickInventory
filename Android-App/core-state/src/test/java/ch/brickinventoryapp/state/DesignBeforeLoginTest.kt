package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.withRepo
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The server's theme is already known before sign-in.
 */
class DesignBeforeLoginTest {

    /**
     * The query against a test server; wiring it into the AppViewModel is run by
     * AppViewModelTest. Counter-check: `@GET("api/v2/settings/theme")`
     * changed to "…/design" → red.
     */
    @Test
    fun `stage two - the public address is called`() {
        withRepo(::testAccountRepository) { paths, admin ->
            runBlocking { admin.getAppTheme() }
            assertEquals(listOf("GET /api/v2/settings/theme"), paths.requests.toList())
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
        assertEquals(listOf("POST /api/v2/admin/cache-clear", "POST /api/v2/admin/cache-clear"), paths.requests.toList())
        assertEquals("the scope (prices only / everything) is not distinguished",
            listOf("{}", """{"all":true}"""), paths.bodyBytes.toList())
    }
}
