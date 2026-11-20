package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Design
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
import ch.brickinventoryapp.account.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
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
 * Die Preisalarm-Übersicht unter „Mehr“, gezeichnet gegen den Testserver: Sie holt ihre
 * Alarme selbst, ändert und löscht über die Route des Sets und löscht erst nach der
 * Rückfrage. Eine Zeile öffnet ihr Set nur, wenn es in der Sammlung liegt, und der
 * Zustand steht als Wort da, nicht nur als Farbe — in beiden Sprachen.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   preisalarm-laedt-nicht         observeLoadOn der Übersicht gestrichen → rot „die Übersicht holt …“
 *   preisalarm-loescht-sofort      der Mülleimer löscht ohne Rückfrage → rot „die Übersicht holt …“
 *   preisalarm-zeile-immer-offen   jede Zeile anklickbar → rot „eine Zeile öffnet …“
 *   preisalarm-zustand-gleich      die Plakette sagt immer „Aktiv“ → rot „eine Zeile öffnet …“
 *   preisalarm-texte-gleich        alerts_fired gleich alerts_armed (de) → rot „die beiden Zustände …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class PriceAlertsDisplayTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val vorher = Locale.getDefault()
    private val world = Examples.Welt(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    private val alerts = """{"success":true,"alerts":[
        {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF",
         "name":"Millennium Falcon","image_local":"/beispiel/set1_thumb.png","besitzt":true,"triggered":false},
        {"set_number":"10179-1","condition":"N","direction":"unter","threshold":900.0,"currency_code":"CHF",
         "name":"Ultimate Falcon","besitzt":false,"triggered":true}]}"""

    private fun einstellungen() = world.t.merke(SettingsViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api),
        world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader {
            override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null
        }))

    /** Zeigt die Übersicht und wartet, bis sie ihre Alarme geholt hat; [geoeffnet] sammelt Klicks auf Sets. */
    private fun zeige(geoeffnet: MutableList<String> = mutableListOf()): SettingsViewModel {
        world.paths.antworten["/api/v1/alerts"] = alerts
        world.paths.antworten["/api/v1/sets/75192-1/alert"] = """{"success":true}"""
        val vm = einstellungen()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    PreisalarmeRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                        snackbarHostState = remember { SnackbarHostState() }, onSetClick = { geoeffnet += it },
                        onZurueck = {}, reportToggle = {})
                }
            }
        }
        wait("Alarme") { vm.alarmOverview.value.geladen }
        return vm
    }

    private fun wait(name: String, fertig: () -> Boolean) {
        driveUntil(name, bereit = fertig)
        compose.waitForIdle()
    }

    private fun requests(methode: String) = world.paths.requests.toList().filter { it.startsWith("$methode ") }

    @Test
    fun `die Uebersicht holt ihre Alarme, aendert und loescht ueber das Set, loescht erst nach Rueckfrage`() {
        zeige()
        assertEquals(listOf("GET /api/v1/alerts"), requests("GET").filter { "alerts" in it })

        compose.onAllNodesWithText(ctx.getString(R.string.detail_alert_chip_above))[0].performClick()
        wait("Richtung") { requests("PUT").isNotEmpty() }
        assertTrue(requests("PUT").toString(), requests("PUT").single().startsWith("PUT /api/v1/sets/75192-1/alert"))

        compose.onNodeWithContentDescription(ctx.getString(R.string.alerts_delete_fuer, "Millennium Falcon")).performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp auf den Mülleimer löscht schon", emptyList<String>(), requests("DELETE"))
        compose.onNode(hasText(ctx.getString(R.string.common_delete)) and hasClickAction() and hasAnyAncestor(isDialog()))
            .performClick()
        wait("Löschen") { requests("DELETE").isNotEmpty() }
        assertTrue(requests("DELETE").single().startsWith("DELETE /api/v1/sets/75192-1/alert"))
    }

    @Test
    fun `eine Zeile oeffnet ihr Set nur, wenn es in der Sammlung liegt, und nennt ihren Zustand in Worten`() {
        val geoeffnet = mutableListOf<String>()
        zeige(geoeffnet)
        compose.onNodeWithContentDescription("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode()

        compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).performClick()
        compose.onNodeWithText("Ultimate Falcon", useUnmergedTree = true).performClick()
        compose.waitForIdle()
        assertEquals("Nur das Set aus der Sammlung öffnet sich", listOf("75192-1"), geoeffnet)

        compose.onNodeWithText(ctx.getString(R.string.alerts_armed), useUnmergedTree = true).fetchSemanticsNode()
        compose.onNodeWithText(ctx.getString(R.string.alerts_fired), useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `die beiden Zustaende sagen in beiden Sprachen ohne Farbe und Zeichen, was gilt`() {
        for (sprache in listOf("de", "en")) {
            val c = ctx.createConfigurationContext(Configuration(ctx.resources.configuration).apply { setLocale(Locale.forLanguageTag(sprache)) })
            val aktiv = c.getString(R.string.alerts_armed)
            val ausgeloest = c.getString(R.string.alerts_fired)
            assertNotEquals("Beide Zustände heissen in $sprache gleich", aktiv.lowercase(), ausgeloest.lowercase())
            for (t in listOf(aktiv, ausgeloest)) {
                assertTrue("„$t“ ($sprache) trägt ein Sinnbildzeichen", t.none { it in '■'..'◿' })
                assertTrue("„$t“ ($sprache) ist kein Wort", t.count { it.isLetter() } >= 4)
            }
            val explanation = c.getString(R.string.detail_alert_fired)
            assertTrue("„$explanation“ ($sprache) erklärt nicht, was als Nächstes geschieht", explanation.trim().contains(' '))
        }
    }
}
