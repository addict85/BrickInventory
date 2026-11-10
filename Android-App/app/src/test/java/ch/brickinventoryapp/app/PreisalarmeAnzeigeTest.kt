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
import ch.brickinventoryapp.konto.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.testing.VerwaltungRepository
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
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
 *   preisalarm-laedt-nicht         LaunchedEffect mit ladeAlarmUebersicht entfernt → rot „die Übersicht holt …“
 *   preisalarm-loescht-sofort      der Mülleimer löscht ohne Rückfrage → rot „die Übersicht holt …“
 *   preisalarm-zeile-immer-offen   jede Zeile anklickbar → rot „eine Zeile öffnet …“
 *   preisalarm-zustand-gleich      die Plakette sagt immer „Aktiv“ → rot „eine Zeile öffnet …“
 *   preisalarm-texte-gleich        alerts_fired gleich alerts_armed (de) → rot „die beiden Zustände …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class PreisalarmeAnzeigeTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val vorher = Locale.getDefault()
    private val welt = Beispiele.Welt(KontextTexte())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        welt.close()
    }

    private val alarme = """{"success":true,"alerts":[
        {"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF",
         "name":"Millennium Falcon","image_local":"/beispiel/set1_thumb.png","besitzt":true,"ausgeloest":false},
        {"set_number":"10179-1","condition":"N","richtung":"unter","schwelle":900.0,"currency_code":"CHF",
         "name":"Ultimate Falcon","besitzt":false,"ausgeloest":true}]}"""

    private fun einstellungen() = welt.t.merke(EinstellungenViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.bestand,
        KontoRepository(welt.t.api, welt.t.cache, welt.t.io),
        VerwaltungRepository(welt.t.api, welt.t.cache),
        SetsRepository(welt.t.api, welt.t.cache),
        TeileRepository(welt.t.api, welt.t.cache),
        object : DateiLeser {
            override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null
        }))

    /** Zeigt die Übersicht und wartet, bis sie ihre Alarme geholt hat; [geoeffnet] sammelt Klicks auf Sets. */
    private fun zeige(geoeffnet: MutableList<String> = mutableListOf()): EinstellungenViewModel {
        welt.pfade.antworten["/api/v1/alerts"] = alarme
        welt.pfade.antworten["/api/v1/sets/75192-1/alert"] = """{"success":true}"""
        val vm = einstellungen()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    PreisalarmeRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                        snackbarHostState = remember { SnackbarHostState() }, onSetClick = { geoeffnet += it },
                        onZurueck = {}, meldeSchalter = {})
                }
            }
        }
        warte("Alarme") { vm.alarmUebersicht.value.geladen }
        return vm
    }

    private fun warte(name: String, fertig: () -> Boolean) {
        treibeBis(name, bereit = fertig)
        compose.waitForIdle()
    }

    private fun anfragen(methode: String) = welt.pfade.anfragen.toList().filter { it.startsWith("$methode ") }

    @Test
    fun `die Uebersicht holt ihre Alarme, aendert und loescht ueber das Set, loescht erst nach Rueckfrage`() {
        zeige()
        assertEquals(listOf("GET /api/v1/alerts"), anfragen("GET").filter { "alerts" in it })

        compose.onAllNodesWithText(ctx.getString(R.string.detail_alert_chip_above))[0].performClick()
        warte("Richtung") { anfragen("PUT").isNotEmpty() }
        assertTrue(anfragen("PUT").toString(), anfragen("PUT").single().startsWith("PUT /api/v1/sets/75192-1/alert"))

        compose.onNodeWithContentDescription(ctx.getString(R.string.alerts_delete_fuer, "Millennium Falcon")).performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp auf den Mülleimer löscht schon", emptyList<String>(), anfragen("DELETE"))
        compose.onNode(hasText(ctx.getString(R.string.common_delete)) and hasClickAction() and hasAnyAncestor(isDialog()))
            .performClick()
        warte("Löschen") { anfragen("DELETE").isNotEmpty() }
        assertTrue(anfragen("DELETE").single().startsWith("DELETE /api/v1/sets/75192-1/alert"))
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
            val erklaerung = c.getString(R.string.detail_alert_fired)
            assertTrue("„$erklaerung“ ($sprache) erklärt nicht, was als Nächstes geschieht", erklaerung.trim().contains(' '))
        }
    }
}
