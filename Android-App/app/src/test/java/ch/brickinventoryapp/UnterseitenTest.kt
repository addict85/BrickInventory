package ch.brickinventoryapp

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onRoot
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Die Unterseiten unter „Mehr“ und die Rückfragen vor Aktionen ohne Weg zurück:
 * Abmelden, Lagerort löschen und Unterkonto entfernen fragen nach; Lagerorte sind
 * Zeilen mit Menü statt Dauer-Textfeldern; jede Unterseite nennt ihren Titel einmal;
 * Haushalt gliedert Einladen und Annehmen; CSV-Import zeigt Aktionen mit Spalten;
 * die leere Bauliste steht mittig mit Rand und bietet kein Zurücksetzen an.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   abmelden-ohne-rueckfrage     „Abmelden“ unter Mehr meldet sofort ab → rot „Abmelden fragt …“
 *   lagerort-loescht-sofort      Löschen im Menü ohne Rückfrage → rot „Lagerorte stehen als Zeilen …“
 *   haushalt-entfernt-sofort     „Entfernen“ trennt sofort → rot „Haushalt gliedert …“
 *   unterseite-doppelter-titel   CSV-Import wieder mit Kartenkopf → rot „CSV-Import zeigt …“
 *   bauliste-leer-zuruecksetzen  „Zurücksetzen“ auch ohne Inhalt aktiv → rot „leere Bauliste …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class UnterseitenTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: android.content.Context = ApplicationProvider.getApplicationContext()
    private val vorher = java.util.Locale.getDefault()
    private val welt = Beispiele.Welt(KontextTexte())

    init { java.util.Locale.setDefault(java.util.Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        java.util.Locale.setDefault(vorher)
        welt.close()
    }

    private fun zeige(inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = "classic") {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        compose.waitForIdle()
    }

    /** Antworten des Testservers kommen über den Hauptlooper; ihn selbst treiben. */
    private fun warte(name: String, fertig: () -> Boolean) {
        val ende = System.nanoTime() + 10_000_000_000L
        while (!fertig()) {
            check(System.nanoTime() < ende) { "$name nach 10 s nicht da" }
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            Thread.sleep(10)
        }
        compose.waitForIdle()
    }

    private fun imDialog(text: String) = compose.onNode(hasText(text) and hasClickAction() and hasAnyAncestor(isDialog()))

    private fun einstellungen() = welt.t.merke(ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel(welt.t.dienste,
        ch.brickinventoryapp.data.repository.KontoRepository(welt.t.api, welt.t.cache),
        ch.brickinventoryapp.data.repository.VerwaltungRepository(welt.t.api, welt.t.cache),
        ch.brickinventoryapp.data.repository.SetsRepository(welt.t.api, welt.t.cache),
        ch.brickinventoryapp.data.repository.TeileRepository(welt.t.api, welt.t.cache),
        object : ch.brickinventoryapp.ui.viewmodel.DateiLeser {
            override suspend fun lies(uri: android.net.Uri): Pair<String?, ByteArray>? = null
        }))

    @Test
    fun `Abmelden fragt erst nach`() {
        var abgemeldet = 0
        zeige { MehrBildschirm(rememberNavController(), isAdmin = false, updateVerfuegbar = false, onAbmelden = { abgemeldet++ }) }
        val abmelden = ctx.getString(R.string.main_menu_logout)
        compose.onNodeWithText(abmelden).performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp allein meldet nicht ab", 0, abgemeldet)
        compose.onNodeWithText(ctx.getString(R.string.logout_confirm_title)).fetchSemanticsNode()
        imDialog(abmelden).performClick()
        compose.waitForIdle()
        assertEquals("Bestätigt meldet ab", 1, abgemeldet)
    }

    /** Der Punkt an den Einstellungen sagt in Worten, wofür er steht. */
    @Test
    fun `Update-Punkt ist beschriftet`() {
        zeige { MehrBildschirm(rememberNavController(), isAdmin = false, updateVerfuegbar = true, onAbmelden = {}) }
        compose.onNodeWithText(ctx.getString(R.string.update_badge)).fetchSemanticsNode()
    }

    @Test
    fun `Lagerorte stehen als Zeilen mit Menue und loeschen erst nach Rueckfrage`() {
        welt.pfade.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[
            {"id":3,"name":"Keller"},{"id":4,"name":"Estrich"},{"id":5,"name":"Regal Wohnzimmer"}]}"""
        val vm = einstellungen().also { it.ladeEigeneLagerorte() }
        zeige { ch.brickinventoryapp.ui.screens.LagerorteUnterseite(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        warte("Lagerorte") { vm.lagerState.value.eigene.size == 3 }
        // Kein Ort als Dauer-Textfeld, der Titel nur in der App-Leiste.
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
        compose.onAllNodesWithText(ctx.getString(R.string.storage_manage), ignoreCase = true).assertCountEquals(1)
        compose.onNodeWithText("Regal Wohnzimmer").fetchSemanticsNode()

        compose.onNodeWithContentDescription(ctx.getString(R.string.storage_menu_cd, "Keller")).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.common_delete)).performClick()
        compose.waitForIdle()
        assertTrue("Gelöscht vor der Rückfrage: ${welt.pfade.anfragen}", welt.pfade.anfragen.none { it.startsWith("DELETE") })
        compose.onNodeWithText(ctx.getString(R.string.storage_delete_title)).fetchSemanticsNode()
        imDialog(ctx.getString(R.string.common_delete)).performClick()
        warte("Löschen") { welt.pfade.anfragen.any { it.startsWith("DELETE") && it.endsWith("/storage/locations/3") } }
    }

    @Test
    fun `Haushalt gliedert Einladen und Annehmen und entfernt erst nach Rueckfrage`() {
        welt.pfade.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"},{"id":3,"username":"tim"}],"open_invites":1}"""
        val vm = welt.t.merke(ch.brickinventoryapp.ui.viewmodel.HaushaltViewModel(welt.t.dienste,
            ch.brickinventoryapp.data.repository.HaushaltRepository(welt.t.api, welt.t.cache),
            ch.brickinventoryapp.data.repository.KontoRepository(welt.t.api, welt.t.cache))).also { it.loadHouseholdStatus() }
        zeige { ch.brickinventoryapp.ui.screens.HaushaltUnterseite(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        warte("Haushalt") { vm.householdState.value.status != null }

        val ueberschrift = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)
        for (titel in listOf(R.string.household_invite_section, R.string.household_redeem_title)) {
            compose.onNode(hasText(ctx.getString(titel)) and ueberschrift).fetchSemanticsNode()
        }
        compose.onAllNodesWithText(ctx.getString(R.string.household_title), ignoreCase = true).assertCountEquals(1)
        // Das Codefeld trägt ein Label, nicht nur einen Platzhalter.
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.household_invite_label))).fetchSemanticsNode()

        compose.onAllNodes(hasText(ctx.getString(R.string.household_remove)) and hasClickAction())[0].performClick()
        compose.waitForIdle()
        assertTrue("Getrennt vor der Rückfrage", welt.pfade.anfragen.none { "household/unlink" in it })
        compose.onNodeWithText(ctx.getString(R.string.household_remove_text, "lena")).fetchSemanticsNode()
        imDialog(ctx.getString(R.string.household_remove)).performClick()
        warte("Trennen") { welt.pfade.anfragen.any { "household/unlink" in it } }
    }

    @Test
    fun `CSV-Import zeigt je Art eine Aktion mit ihren Spalten und den Titel einmal`() {
        val vm = einstellungen()
        zeige { ch.brickinventoryapp.ui.screens.CsvImportUnterseite(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        compose.onAllNodesWithText(ctx.getString(R.string.csv_upload_title), ignoreCase = true).assertCountEquals(1)
        compose.onNode(hasText(ctx.getString(R.string.csv_upload_sets)) and hasClickAction() and
            SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)).fetchSemanticsNode()
        compose.onNodeWithText(ctx.getString(R.string.csv_format_parts), useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `leere Bauliste steht mittig und bietet kein Zuruecksetzen an`() {
        zeige {
            ch.brickinventoryapp.ui.screens.PartsListScreen(serverUrl = "", imageLoader = coil3.ImageLoader.Builder(ctx).build(),
                onScanBarcode = {}, onResolveSet = { error("nichts aufzulösen") })
        }
        compose.onNode(hasText(ctx.getString(R.string.partslist_reset)) and hasClickAction()).assertIsNotEnabled()
        val dichte = ctx.resources.displayMetrics.density
        val breite = compose.onRoot().fetchSemanticsNode().boundsInRoot.width
        for (text in listOf(R.string.partslist_empty_title, R.string.partslist_empty_hint)) {
            val b = compose.onNodeWithText(ctx.getString(text)).fetchSemanticsNode().boundsInRoot
            assertTrue("${ctx.getString(text)} klebt am Rand (${b.left / dichte} dp)", b.left >= 16 * dichte)
            assertTrue("${ctx.getString(text)} steht nicht mittig ($b in $breite)",
                kotlin.math.abs((b.left + b.right) / 2 - breite / 2) < 2 * dichte)
        }
    }
}
