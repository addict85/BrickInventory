package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.Preisalarm
import ch.brickinventoryapp.data.testing.BrickApiService
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAlarmRepository
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.testing.Sources
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.http.DELETE
import retrofit2.http.PUT

/**
 * The price alert overview exists in the app just as in the web app: an alert
 * that only stands in the detail of its set can only be found if one already knows the set.
 * The web app checks the opposite direction (test/webapp-endpoints.test.js).
 *
 * Counter-check (counter-checks/alarm-besitzt-vorgabe-falsch.patch): default of `owns`
 * to false → red “a missing owns field …”. Loading, changing, deleting after confirmation,
 * click and state words are checked, drawn, by PriceAlertsDisplayTest.
 */
class AlarmOverviewTest {

    private fun source(rel: String) = Sources.withoutComments(Sources.read(rel))

    /**
     * Executed against a test server. Counter-check: in
     * SetsApi `@GET("api/v1/alerts")` to "api/v1/alarme" → red.
     */
    @Test
    fun `the app fetches all alerts via the common route`() {
        val paths = PathServer("/api/v1/alerts" to """{"success":true,"alerts":[]}""")
        try {
            runBlocking {
                testAlarmRepository(TestApi.forTarget(paths.server)).refreshAlerts()
            }
            assertEquals(listOf("GET /api/v1/alerts"), paths.requests.toList())
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
        val secondRoute = changing.filter { it.startsWith("api/v1/alerts") }
        assertTrue("A second write path has appeared: $secondRoute", secondRoute.isEmpty())
    }

    /**
     * The thumbnail comes as in the finances via [FinanceImage] and [resolveThumbUrl].
     * That the row shows an image and only opens a set from the collection is checked,
     * drawn, by PriceAlertsDisplayTest.
     */
    @Test
    fun `the row shows the image like the finances`() {
        val s = source("account/ui/screens/SettingsAlarme.kt")
        assert(s.contains("FinanceImage(")) {
            "The row has no preview image — or its own instead of the finances' one."
        }
        assert(s.contains("resolveThumbUrl(")) {
            "The image address is not built via the shared place."
        }
    }

    /**
     * A missing field does not switch off the section. An older server does not send
     * `owns`; with the default `false` „field missing“ would mean the same as „set does not exist“
     * , and no row would be clickable any more. When in doubt, try: a click
     * that ends in an error message is better than a list in which nothing works.
     */
    @Test
    fun `a missing besitzt field does not kill the row`() {
        val alarm = BrickJson.decodeFromString(Preisalarm.serializer(),
            """{"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF"}""")
        assertTrue("Without the field the set counts as not present — the whole section would be dead", alarm.besitzt)
        val gone = BrickJson.decodeFromString(Preisalarm.serializer(), """{"set_number":"75192-1","besitzt":false}""")
        assertFalse(gone.besitzt)
    }

    /**
     * The settings come back at the same position.
     *
     * “When one comes back one should be at the same position again
     * (analogous to how it is with the finances)."
     *
     * The path into the detail view discards the destination; the position must therefore lie in the
     * ScrollMemory and be set explicitly when coming back.
     */
    @Test
    fun `the settings remember their scroll position`() {
        val graph = source("account/ui/AccountGraph.kt")
        assert(graph.contains("settingsScrollState")) {
            "The settings still hold their scroll state themselves — after " +
                "returning from the detail view one would be back at the very top."
        }
        assert(Regex("""AccountTarget\.Settings\.rollKey,\s*settingsScrollState""").containsMatchIn(graph)) {
            "The scroll state is not remembered — it survives, but nobody " +
                "jumps back."
        }
        // The ScrollMemory holds the position, not the state: it arises anew per visit.
        assert(graph.contains("val settingsScrollState = remember { ScrollState(0) }")) {
            "The settings do not create their scroll state at the destination"
        }
        val screen = source("account/ui/screens/SettingsScreen.kt")
        assert(!screen.contains("rememberScrollState()")) {
            "SettingsScreen has its own rememberScrollState() again — " +
                "which makes the passed-in state ineffective."
        }
    }

    /**
     * The alert state stands as a badge, not as small text.
     *
     * “Please show the ‚armed' in the Android app like the web app with a label
     * instead of the green check mark."
     *
     * The green check mark was in truth the SAVE button: it stood permanently
     * next to the number field and read like a confirmation. Hence two statements
     * in one test — the badge comes, and the button stops standing there
     * permanently.
     */
    @Test
    fun `the alert state stands as a badge`() {
        // That it shows „Aktiv“ and „Ausgelöst“ in words is checked by PriceAlertsDisplayTest.
        val s = source("account/ui/screens/SettingsAlarme.kt")
        // The save button appears only on a change. Without this
        // barrier a symbol stands permanently next to it again that looks like a
        // state indicator.
        // Until the settings were split, `val changed =` matched from the
        // account card; nothing was checked by that. The barrier is the comparison.
        assert(s.contains("number != a.threshold")) {
            "The save button stands there permanently again and looks like a state."
        }

        // ── The difference must not lie in the color ────────────────────────
        //
        // Red-green deficiency is common; „armed“ against „no longer armed“ must not
        // depend on green against gray alone.
        //
        // A statement that only stands in the
        // color stands nowhere. This test therefore requires a
        // difference that one sees WITHOUT color.
        val body = s.substring(s.indexOf("fun AlarmStateBadge("))
            .let { it.substring(0, minOf(1200, it.length)) }
        assert(body.contains("BorderStroke(")) {
            "The two states do not differ in the surface " +
                "(filled versus outlined) — then only the color would be left."
        }
        assert(body.contains("FontWeight.SemiBold")) {
            "The font weight no longer tells the two apart either."
        }
        // No green against red, not even well-meant — that would be the same
        // error once more.
        for (forbidden in listOf("LocalStatusColors", "colorScheme.error",
                                "colorScheme.tertiary")) {
            assert(!body.contains(forbidden)) {
                "`$forbidden` carries a meaning via the color. That is exactly what " +
                    "the badge should no longer do."
            }
        }
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
