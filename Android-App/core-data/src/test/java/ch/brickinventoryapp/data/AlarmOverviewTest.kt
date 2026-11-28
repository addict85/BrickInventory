package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.testing.BrickApiService
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAlarmRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.http.DELETE
import retrofit2.http.PUT

/**
 * The price alert overview exists in the app just as in the web app: an alert
 * that only stands in the detail of its set can only be found if one already knows the set.
 * The web app checks the opposite direction (test/webapp-endpoints.test.js).
 *
 * Loading, changing, deleting after confirmation, click, state words, preview image and saving on “Done” are checked, drawn, by PriceAlertsDisplayTest.
 */
class AlarmOverviewTest {

    /**
     * Executed against a test server. Counter-check: in
     * SetsApi `@GET("api/v2/alerts")` to "api/v2/alarme" → red.
     */
    @Test
    fun `the app fetches all alerts via the common route`() {
        val paths = PathServer("/api/v2/alerts" to """{"success":true,"alerts":[]}""")
        try {
            runBlocking {
                testAlarmRepository(TestApi.forTarget(paths.server)).refreshAlerts()
            }
            assertEquals(listOf("GET /api/v2/alerts"), paths.requests.toList())
        } finally {
            paths.server.shutdown()
        }
    }

    @Test
    fun `writing goes via the existing route to the set`() {
        // Two write paths to the same state would be two places where the rules
        // drift apart; the overview only READS independently. That changing and
        // deleting call the set route is checked by SettingsViewModelTest on the
        // requests. Here the annotations of the interface, via reflection.
        // The CSV import (POST …/alerts/import/csv) creates, it changes no alert.
        val changing = BrickApiService::class.java.methods.mapNotNull { m ->
            m.getAnnotation(PUT::class.java)?.value
                ?: m.getAnnotation(DELETE::class.java)?.value
        }
        assertTrue("No changing addresses found — does reflection still work?", changing.size > 10)
        val secondRoute = changing.filter { it.startsWith("api/v2/alerts") }
        assertTrue("A second write path has appeared: $secondRoute", secondRoute.isEmpty())
    }

    // The opposite direction — „does the WEB APP have the section too?“ — deliberately does
    // NOT stand here. It has its own rule there: Web-App/test/
    // webapp-endpoints.test.js requires that an address only the web app
    // calls is either caught up by the app or carries a reason with it.
    // Exactly this rule triggered building this section.
    //
    // A second test for it here would have needed a path across the tree boundary
    // that exists nowhere in this test tree — the first draft
    // invented a helper for it that did not exist.
}
