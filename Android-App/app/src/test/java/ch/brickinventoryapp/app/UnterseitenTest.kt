package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Design
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
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.testing.HaushaltRepository
import ch.brickinventoryapp.testing.VerwaltungRepository
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
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.teile.ui.TeilelisteUiState
import ch.brickinventoryapp.konto.ui.screens.CsvImportRoute
import ch.brickinventoryapp.konto.ui.screens.HaushaltRoute
import ch.brickinventoryapp.konto.ui.screens.KontoRoute
import ch.brickinventoryapp.konto.ui.screens.LagerorteRoute
import ch.brickinventoryapp.teile.ui.screens.PartsListRoute
import ch.brickinventoryapp.teile.ui.screens.PartsListScreen
import ch.brickinventoryapp.konto.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.HaushaltViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.KontoViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.TeilelisteViewModel
import android.content.Context
import android.os.Looper
import java.util.Locale
import org.robolectric.Shadows
import org.robolectric.shadows.ShadowDialog
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.SitzungsAttrappe
import ch.brickinventoryapp.testing.TeileRepository

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
 *   bauliste-leer-zuruecksetzen  „Zurücksetzen“ auch ohne Sets sichtbar → rot „leere Bauliste …“
 *   lagerort-stern-als-knopf     Stern wieder IconButton ohne Ort → rot „Der Vorgabe-Stern …“
 *   haushalt-entfernen-ohne-name „Entfernen“ ohne Kontonamen → rot „Entfernen nennt …“
 *   preisalarm-nummer-zuerst     Rückfrage nennt wieder nur die Nummer → rot „Preisalarme nennen …“
 *   konto-ohne-wiederholung      Passwort ändern ohne passende Wiederholung frei → rot „Konto wechselt …“
 *   bauliste-zweistufig          Erstellen erst nach „+“ → rot „Bauliste entsteht …“
 *   bauliste-plus-ohne-wirkung   „+“ im Feld nimmt das Set nicht auf → rot „Bauliste nimmt Sets …“
 *   konto-profil-ohne-rueckfrage Speichern ohne Passwortdialog → rot „Konto fragt beim Speichern …“
 *   konto-email-ohne-ausstehend  die beantragte Adresse nicht unter dem Feld → rot „Konto nennt …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class UnterseitenTest {

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

    private fun zeige(inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        compose.waitForIdle()
    }

    /** Die Welt antwortet im Takt; den Hauptlooper treiben, bis [fertig] gilt. */
    private fun warte(name: String, fertig: () -> Boolean) {
        treibeBis(name, bereit = fertig)
        compose.waitForIdle()
    }

    /** Die Bauliste, wie der Graph sie zeigt: Route mit ViewModel, ohne Netz. */
    @Composable
    private fun bauliste(vm: TeilelisteViewModel) =
        PartsListRoute(serverUrl = "", imageLoader = coil3.ImageLoader.Builder(ctx).build(),
            onScanBarcode = {}, hatUnterkonten = false, barcodeSetNumber = null, onBarcodeConsumed = {},
            listState = androidx.compose.foundation.lazy.rememberLazyListState(), manuelleErfassungAnfordern = false,
            onManuelleErfassungQuittiert = {}, vm = vm)

    private fun imDialog(text: String) = compose.onNode(hasText(text) and hasClickAction() and hasAnyAncestor(isDialog()))

    private fun einstellungen() = welt.t.merke(EinstellungenViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.abgleich,
        KontoRepository(welt.t.api, welt.t.cache, welt.t.io), VerwaltungRepository(welt.t.api, welt.t.cache),
        SetsRepository(welt.t.api, welt.t.cache), TeileRepository(welt.t.api, welt.t.cache),
        object : DateiLeser {
            override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null
        }))

    @Test
    fun `Abmelden fragt erst nach`() {
        var abgemeldet = 0
        zeige { MehrBildschirm({}, isAdmin = false, updateVerfuegbar = false, onAbmelden = { abgemeldet++ }) }
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
        zeige { MehrBildschirm({}, isAdmin = false, updateVerfuegbar = true, onAbmelden = {}) }
        compose.onNodeWithText(ctx.getString(R.string.update_badge)).fetchSemanticsNode()
    }

    @Test
    fun `Lagerorte stehen als Zeilen mit Menue und loeschen erst nach Rueckfrage`() {
        welt.pfade.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[
            {"id":3,"name":"Keller"},{"id":4,"name":"Estrich"},{"id":5,"name":"Regal Wohnzimmer"}]}"""
        val vm = einstellungen().also { it.ladeEigeneLagerorte() }
        zeige { LagerorteRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
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
        val vm = welt.t.merke(HaushaltViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.abgleich,
            HaushaltRepository(welt.t.api, welt.t.cache), KontoRepository(welt.t.api, welt.t.cache, welt.t.io))).also { it.loadHouseholdStatus() }
        zeige { HaushaltRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
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
        zeige { CsvImportRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        compose.onAllNodesWithText(ctx.getString(R.string.csv_upload_title), ignoreCase = true).assertCountEquals(1)
        compose.onNode(hasText(ctx.getString(R.string.csv_upload_sets)) and hasClickAction() and
            SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)).fetchSemanticsNode()
        compose.onNodeWithText(ctx.getString(R.string.csv_format_parts), useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `leere Bauliste steht mittig und bietet kein Zuruecksetzen an`() {
        zeige {
            PartsListScreen(TeilelisteUiState(),
                serverUrl = "", imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {})
        }
        compose.onAllNodes(hasText(ctx.getString(R.string.partslist_reset)) and hasClickAction()).assertCountEquals(0)
        val dichte = ctx.resources.displayMetrics.density
        val breite = compose.onRoot().fetchSemanticsNode().boundsInRoot.width
        for (text in listOf(R.string.partslist_empty_title, R.string.partslist_empty_hint)) {
            val b = compose.onNodeWithText(ctx.getString(text)).fetchSemanticsNode().boundsInRoot
            assertTrue("${ctx.getString(text)} klebt am Rand (${b.left / dichte} dp)", b.left >= 16 * dichte)
            assertTrue("${ctx.getString(text)} steht nicht mittig ($b in $breite)",
                kotlin.math.abs((b.left + b.right) / 2 - breite / 2) < 2 * dichte)
        }
    }

    @Test
    fun `Der Vorgabe-Stern ist ein Schalter mit dem Namen des Orts`() {
        welt.pfade.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[{"id":3,"name":"Keller"}]}"""
        val vm = einstellungen().also { it.ladeEigeneLagerorte() }
        zeige { LagerorteRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        warte("Lagerorte") { vm.lagerState.value.eigene.size == 1 }
        val stern = compose.onNodeWithContentDescription(ctx.getString(R.string.storage_vorgabe_cd, "Keller")).fetchSemanticsNode()
        assertEquals("TalkBack hört an/aus", ToggleableState.Off, stern.config.getOrNull(SemanticsProperties.ToggleableState))
    }

    @Test
    fun `Entfernen nennt das Konto im Haushalt`() {
        welt.pfade.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"},{"id":3,"username":"tim"}],"open_invites":1}"""
        val vm = welt.t.merke(HaushaltViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.abgleich,
            HaushaltRepository(welt.t.api, welt.t.cache), KontoRepository(welt.t.api, welt.t.cache, welt.t.io))).also { it.loadHouseholdStatus() }
        zeige { HaushaltRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        warte("Haushalt") { vm.householdState.value.status != null }
        val entfernen = ctx.getString(R.string.household_remove)
        for (name in listOf("lena", "tim")) {
            compose.onNode(hasContentDescription(ctx.getString(R.string.aktion_fuer, entfernen, name)) and hasClickAction())
                .fetchSemanticsNode("„$entfernen“ nennt $name nicht")
        }
    }

    @Test
    fun `Preisalarme nennen den Namen zuerst und in der Rueckfrage`() {
        welt.pfade.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF","name":"Millennium Falcon"}]}"""
        val vm = einstellungen()
        zeige {
            PreisalarmeRoute(vm = vm,
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, meldeSchalter = {})
        }
        warte("Alarme") { vm.alarmUebersicht.value.geladen }
        val name = compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val nummer = compose.onNodeWithText("75192-1", substring = true, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("Name ($name) über der Nummer ($nummer)", name.bottom <= nummer.top)
        compose.onNodeWithContentDescription(ctx.getString(R.string.alerts_delete_fuer, "Millennium Falcon")).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.alerts_confirm_delete, "Millennium Falcon")).fetchSemanticsNode()
    }

    @Test
    fun `Konto wechselt das Passwort erst mit passender Wiederholung`() {
        welt.pfade.antworten["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true}}"""
        val konto = welt.t.merke(KontoViewModel(
            KontoRepository(welt.t.api, welt.t.cache, welt.t.io), KontextTexte(),
            welt.t.meldungen, welt.t.sitzung, SitzungsAttrappe()))
        zeige {
            KontoRoute(snackbarHostState = remember { SnackbarHostState() },
                konto = konto, onZurueck = {})
        }
        warte("Profil") { konto.kontoState.value.profil != null }
        fun feld(label: Int) = compose.onAllNodes(hasSetTextAction() and hasText(ctx.getString(label)))[0]
        val wechseln = compose.onNode(hasText(ctx.getString(R.string.konto_password_button)) and hasClickAction())
        feld(R.string.konto_password_current).performTextInput("altes-passwort-1")
        feld(R.string.konto_password_new).performTextInput("neues-passwort-12")
        feld(R.string.startpasswort_wiederholen).performTextInput("anderes-passwort-1")
        compose.waitForIdle()
        wechseln.assertIsNotEnabled()
        feld(R.string.startpasswort_wiederholen).performTextClearance()
        feld(R.string.startpasswort_wiederholen).performTextInput("neues-passwort-12")
        compose.waitForIdle()
        wechseln.assertIsEnabled()
    }

    /** Eine neue Adresse gilt erst nach dem Link: Das Feld zeigt die geltende, darunter die beantragte. */
    @Test
    fun `Konto nennt die beantragte E-Mail unter dem Feld`() {
        welt.pfade.antworten["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true,
            "email_neu":"neu@example.org"}}"""
        val konto = welt.t.merke(KontoViewModel(
            KontoRepository(welt.t.api, welt.t.cache, welt.t.io), KontextTexte(),
            welt.t.meldungen, welt.t.sitzung, SitzungsAttrappe()))
        zeige {
            KontoRoute(snackbarHostState = remember { SnackbarHostState() },
                konto = konto, onZurueck = {})
        }
        warte("Profil") { konto.kontoState.value.profil != null }
        compose.onNode(hasSetTextAction() and hasText("marco@example.org")).fetchSemanticsNode("Das Feld zeigt die geltende Adresse nicht")
        compose.onNodeWithText(ctx.getString(R.string.konto_email_ausstehend, "neu@example.org"), useUnmergedTree = true)
            .fetchSemanticsNode("Die beantragte Adresse fehlt unter dem Feld")
    }

    /** Geändert wird über die Textaktion, nicht durch Tippen: kein fokussiertes Feld. */
    @Test
    fun `Konto fragt beim Speichern des Profils nach dem Passwort`() {
        welt.pfade.antworten["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true}}"""
        val konto = welt.t.merke(KontoViewModel(
            KontoRepository(welt.t.api, welt.t.cache, welt.t.io), KontextTexte(),
            welt.t.meldungen, welt.t.sitzung, SitzungsAttrappe()))
        zeige {
            KontoRoute(snackbarHostState = remember { SnackbarHostState() },
                konto = konto, onZurueck = {})
        }
        warte("Profil") { konto.kontoState.value.profil != null }
        compose.onAllNodes(hasSetTextAction() and hasText(ctx.getString(R.string.register_first_name)))[0]
            .performSemanticsAction(SemanticsActions.SetText) { it(AnnotatedString("Marc")) }
        compose.waitForIdle()
        val speichern = compose.onNode(hasText(ctx.getString(R.string.konto_save)) and hasClickAction())
        speichern.performScrollTo()
        // Steht auf dieser Seite ein Dialog mit Textfeld, wird Compose unter Robolectric
        // nicht mehr ruhig. Darum ohne waitForIdle: Uhr anhalten, Looper leeren und das
        // Dialogfenster bei Robolectric selbst nachsehen.
        compose.mainClock.autoAdvance = false
        speichern.performClick()
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
        val dialog = ShadowDialog.getLatestDialog()
        assertTrue("Kein Passwortdialog beim Speichern", dialog?.isShowing == true)
        assertTrue("Gespeichert ohne Passwort: ${welt.pfade.anfragen}", welt.pfade.anfragen.none { it.startsWith("PUT") })
        dialog?.dismiss()
        Shadows.shadowOf(Looper.getMainLooper()).idle()
    }

    @Test
    fun `Bauliste nimmt Sets ueber das Plus im Feld und setzt bei ihnen zurueck`() {
        val vm = welt.bauliste()
        zeige { bauliste(vm) }
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.gallery_set_number)))
            .performSemanticsAction(SemanticsActions.SetText) { it(AnnotatedString("21318")) }
        compose.waitForIdle()
        compose.onNodeWithContentDescription(ctx.getString(R.string.partslist_add_set)).performClick()
        compose.waitForIdle()
        val chip = hasText("21318-1") and hasClickAction()
        compose.onNode(chip).fetchSemanticsNode("Das Set steht nicht in der Liste")
        compose.onNode(hasText(ctx.getString(R.string.partslist_generate)) and hasClickAction()).assertIsEnabled()
        compose.onNode(hasText(ctx.getString(R.string.partslist_reset)) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onAllNodes(chip).assertCountEquals(0)
        compose.onAllNodes(hasText(ctx.getString(R.string.partslist_reset)) and hasClickAction()).assertCountEquals(0)
    }

    @Test
    fun `Bauliste entsteht in einem Schritt aus der getippten Nummer`() {
        val aufgeloest = mutableListOf<String>()
        val vm = welt.bauliste { nr -> aufgeloest += nr; "Baumhaus" to emptyList() }
        zeige { bauliste(vm) }
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.gallery_set_number))).performTextInput("21318")
        compose.onNode(hasText(ctx.getString(R.string.partslist_generate)) and hasClickAction()).assertIsEnabled().performClick()
        warte("Bauliste") { aufgeloest.isNotEmpty() }
        assertEquals(listOf("21318-1"), aufgeloest)
    }
}
