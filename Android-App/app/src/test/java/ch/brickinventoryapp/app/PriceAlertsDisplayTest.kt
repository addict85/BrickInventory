package ch.brickinventoryapp.app

import android.content.Context
import android.content.res.Configuration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.remember
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.screens.PriceAlarmsRoute
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * The price alert overview under “More”, drawn against the test server: it fetches its
 * alerts itself, changes and deletes via the set's route and deletes only after the
 * confirmation. A row opens its set only if it is in the collection, and the
 * state stands as a word, not only as a color — in both languages.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   preisalarm-laedt-nicht         observeLoadOn of the overview deleted → red “the overview fetches …”
 *   preisalarm-loescht-sofort      the trash can deletes without confirmation → red “the overview fetches …”
 *   preisalarm-zeile-immer-offen   every row clickable → red “a row opens …”
 *   preisalarm-zustand-gleich      the badge always says „Aktiv“ → red “a row opens …”
 *   preisalarm-texte-gleich        alerts_fired equal to alerts_armed (de) → red “the two states …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class PriceAlertsDisplayTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val before = Locale.getDefault()
    private val world = Examples.World(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    private val alerts = """{"success":true,"alerts":[
        {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF",
         "name":"Millennium Falcon","image_local":"/beispiel/set1_thumb.png","besitzt":true,"triggered":false},
        {"set_number":"10179-1","condition":"N","direction":"unter","threshold":900.0,"currency_code":"CHF",
         "name":"Ultimate Falcon","besitzt":false,"triggered":true}]}"""

    private fun settings() = world.t.track(SettingsViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api),
        world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader {
            override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
        }))

    /** Shows the overview and waits until it has fetched its alerts; [opened] collects clicks on sets. */
    private fun show(opened: MutableList<String> = mutableListOf()): SettingsViewModel {
        world.paths.responses["/api/v1/alerts"] = alerts
        world.paths.responses["/api/v1/sets/75192-1/alert"] = """{"success":true}"""
        val vm = settings()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    PriceAlarmsRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                        snackbarHostState = remember { SnackbarHostState() }, onSetClick = { opened += it },
                        onBack = {}, reportToggle = {})
                }
            }
        }
        wait("alerts") { vm.alarmOverview.value.loaded }
        return vm
    }

    private fun wait(name: String, done: () -> Boolean) {
        driveUntil(name, ready = done)
        compose.waitForIdle()
    }

    private fun requests(method: String) = world.paths.requests.toList().filter { it.startsWith("$method ") }

    @Test
    fun `the overview fetches its alerts, changes and deletes via the set, deletes only after confirmation`() {
        show()
        assertEquals(listOf("GET /api/v1/alerts"), requests("GET").filter { "alerts" in it })

        compose.onAllNodesWithText(ctx.getString(R.string.detail_alert_chip_above))[0].performClick()
        wait("direction") { requests("PUT").isNotEmpty() }
        assertTrue(requests("PUT").toString(), requests("PUT").single().startsWith("PUT /api/v1/sets/75192-1/alert"))

        compose.onNodeWithContentDescription(ctx.getString(R.string.alerts_delete_for, "Millennium Falcon")).performClick()
        compose.waitForIdle()
        assertEquals("a tap on the bin already deletes", emptyList<String>(), requests("DELETE"))
        compose.onNode(hasText(ctx.getString(R.string.common_delete)) and hasClickAction() and hasAnyAncestor(isDialog()))
            .performClick()
        wait("delete") { requests("DELETE").isNotEmpty() }
        assertTrue(requests("DELETE").single().startsWith("DELETE /api/v1/sets/75192-1/alert"))
    }

    @Test
    fun `a row opens its set only if it is in the collection, and names its state in words`() {
        val opened = mutableListOf<String>()
        show(opened)
        compose.onNodeWithContentDescription("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode()

        compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).performClick()
        compose.onNodeWithText("Ultimate Falcon", useUnmergedTree = true).performClick()
        compose.waitForIdle()
        assertEquals("only the set from the collection opens", listOf("75192-1"), opened)

        compose.onNodeWithText(ctx.getString(R.string.alerts_armed), useUnmergedTree = true).fetchSemanticsNode()
        compose.onNodeWithText(ctx.getString(R.string.alerts_fired), useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `the two states say in both languages without color and symbol what applies`() {
        for (language in listOf("de", "en")) {
            val c = ctx.createConfigurationContext(Configuration(ctx.resources.configuration).apply { setLocale(Locale.forLanguageTag(language)) })
            val active = c.getString(R.string.alerts_armed)
            val triggered = c.getString(R.string.alerts_fired)
            assertNotEquals("both states are called the same in $language", active.lowercase(), triggered.lowercase())
            for (t in listOf(active, triggered)) {
                assertTrue("“$t” ($language) carries a symbol character", t.none { it in '■'..'◿' })
                assertTrue("“$t” ($language) is not a word", t.count { it.isLetter() } >= 4)
            }
            val explanation = c.getString(R.string.detail_alert_fired)
            assertTrue("“$explanation” ($language) does not explain what happens next", explanation.trim().contains(' '))
        }
    }
}
