package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.doubleClick
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.account.ui.screens.SecondFactorRequiredMask
import ch.brickinventoryapp.account.ui.screens.SettingsExits
import ch.brickinventoryapp.account.ui.screens.SettingsScreen
import ch.brickinventoryapp.account.ui.screens.SettingsState
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.account.ui.viewmodel.UpdateActions
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.app.ui.components.CsvImportBanner
import ch.brickinventoryapp.app.ui.components.CsvProgress
import ch.brickinventoryapp.catalog.ui.screens.CatalogSetCard
import ch.brickinventoryapp.collection.ui.screens.SetCard
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.PartListUiState
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.screens.PartsListScreen
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.shared.ui.FilterChoice
import ch.brickinventoryapp.shared.ui.FilterSection
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceActions
import ch.brickinventoryapp.ui.components.ExplainText
import ch.brickinventoryapp.ui.components.LoadCircle
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.SearchField
import ch.brickinventoryapp.ui.components.Subpage
import ch.brickinventoryapp.ui.components.ThrottledAnnouncement
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.components.catalogName
import ch.brickinventoryapp.ui.screens.CameraOverlay
import ch.brickinventoryapp.ui.theme.AppCard
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
import java.util.Locale

/**
 * What TalkBack, keyboard and large font find at the central building blocks, checked as
 * behavior. Building blocks only one area uses are checked there (PriceAlertSwitchTest,
 * ThemeRowRoleTest), so they can stay internal.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   schalter-ohne-namen          build list checkboxes again with own callback → red “checkboxes of the build list carry …”
 *   suchfeld-ohne-namen          search field without contentDescription → red “search field keeps its name …”
 *   filterwahl-als-kaestchen     FilterChoice again as SelectionChip → red “filter choice is a single choice …”
 *   ansage-ungedrosselt          ThrottledAnnouncement passes on every wording → red “status messages are live regions and …”
 *   bildzoom-nur-geste           zoom bar in the image dialog removed → red “image zoom works with buttons …”
 *   fokus-ohne-rahmen            focusFrame draws nothing → red “keyboard focus shows a frame …”
 *   csv-aufklapper-stumm         state and expanding removed from the CSV bar → red “CSV bar names state, expanding …”
 *   setkachel-name-hinten        name of the set tile again below number and condition → red “set and catalog tile read …”
 *   unterseite-einzeilig         subpage again with single-line title → red “long titles wrap at …”
 *   rueckfrage-ohne-ueberschrift title of the confirmation without heading → red “the confirmation names its …”
 *   notfallcodes-als-wort        emergency codes without readAloudAs → red “emergency codes are read out …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class AccessibilityTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val images = SampleImages.loader(ctx)

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    private fun show(font: Float = 1f, content: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, font)) {
                    Surface(color = MaterialTheme.colorScheme.background) { content() }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun role(n: SemanticsNode) = n.config.getOrNull(SemanticsProperties.Role)

    private fun layout(n: SemanticsNode): TextLayoutResult {
        val outcome = mutableListOf<TextLayoutResult>()
        n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
        return outcome.single()
    }

    /**
     * Text or description per node, in the order of the tree below [n]. Below
     * clearAndSetSemantics nothing: the unmerged tree still carries the replaced children,
     * TalkBack does not read them (like SemanticsNode.mergeConfig).
     */
    private fun announced(n: SemanticsNode): List<String> {
        val own = n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty() +
            n.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        return if (n.config.isClearingSemantics) own else own + n.children.flatMap { announced(it) }
    }

    private fun checkToggle(text: String, expected: Role, an: Boolean) {
        val node = compose.onNode(hasText(text) and isToggleable()).fetchSemanticsNode("„$text“ ist kein Schalter mit Namen")
        assertEquals("$text: role", expected, role(node))
        assertEquals("$text: state", if (an) ToggleableState.On else ToggleableState.Off,
            node.config.getOrNull(SemanticsProperties.ToggleableState))
    }

    @Test
    fun `checkboxes of the build list carry names and toggle via the row`() {
        var lose: Boolean? = null
        var below: Boolean? = null
        val part = PlPart(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", colorHex = "C91A09",
            quantity = 4, imageUrl = null)
        show {
            PartsListScreen(PartListUiState(parts = listOf(part), generated = true), serverUrl = "",
                imageLoader = images, onScanBarcode = {}, onOnlyLose = { lose = it }, onWithSubAccounts = { below = it },
                hasSubAccounts = true)
        }
        val onlyLose = ctx.getString(R.string.partslist_only_loose)
        val withBelow = ctx.getString(R.string.partslist_include_subs)
        checkToggle(onlyLose, Role.Checkbox, false)
        checkToggle(withBelow, Role.Checkbox, false)
        compose.onNode(hasText(onlyLose) and isToggleable()).performClick()
        compose.onNode(hasText(withBelow) and isToggleable()).performClick()
        compose.waitForIdle()
        assertEquals("a tap on the row toggles “loose only”", true, lose)
        assertEquals("a tap on the row toggles “with sub-accounts”", true, below)
    }

    @Test
    fun `the user certificate switch carries its name and toggles via its text`() {
        var ca: Boolean? = null
        val update = object : UpdateActions {
            override fun checkOnUpdate(still: Boolean) = Unit
            override fun checkOnStart() = Unit
            override fun setStartCheck(an: Boolean) = Unit
            override fun closeUpdateHint() = Unit
            override fun loadUpdate() = Unit
            override fun cancelLoad() = Unit
            override fun startInstallation() = Unit
        }
        val appearance = object : AppearanceActions {
            override fun setLanguage(languageCode: String) = Unit
            override fun setBrightness(choice: String) = Unit
            override fun setSystemColors(an: Boolean) = Unit
            override fun setPreviewHidden(an: Boolean) = Unit
            override fun setWidgetValues(an: Boolean) = Unit
        }
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.t.track(SettingsViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.sync, testAccountRepository(world.t.api),
                testManagementRepository(world.t.api), world.t.alerts(),
                testPartsRepository(world.t.api),
                object : FileReader {
                    override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
                }))
            show {
                Column {
                    SettingsScreen(
                        condition = SettingsState(AppUiState(serverUrl = "https://brick.example.org"), UpdateUiState(),
                            "system", Design.CLASSIC, false, false, false, false),
                        actions = vm, update = update, appearance = appearance, exits = object : SettingsExits {
                            override fun logout() = Unit
                            override fun switchServer() = Unit
                            override fun setUserCa(on: Boolean) { ca = on }
                        },
                        scrollState = androidx.compose.foundation.rememberScrollState(),
                    )
                }
            }
            val userCa = ctx.getString(R.string.settings_user_ca)
            compose.onNode(hasText(userCa) and isToggleable()).performScrollTo()
            checkToggle(userCa, Role.Switch, false)
            compose.onNode(hasText(userCa) and isToggleable()).performClick()
            assertEquals("a tap on the text toggles", true, ca)
        } finally {
            world.close()
        }
    }

    @Test
    fun `search field keeps its name after input and wraps at 200 percent`() {
        val placeholder = "Nummer oder Name eines Sets im Katalog"
        show(font = 2f) {
            var value by remember { mutableStateOf("") }
            Column(Modifier.width(360.dp)) { SearchField(value, { value = it }, placeholder) }
        }
        val display = compose.onAllNodes(hasText(placeholder), useUnmergedTree = true).fetchSemanticsNodes()
            .first { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
        assertTrue("placeholder cut off at 200 %", !layout(display).hasVisualOverflow)
        compose.onNode(hasSetTextAction()).performTextInput("Falcon")
        compose.waitForIdle()
        val field = compose.onNode(hasSetTextAction()).fetchSemanticsNode()
        val name = field.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
        assertTrue("field without a name after input: $name", placeholder in name)
    }

    @Test
    fun `filter choice is a single choice with heading and wraps`() {
        val lang = "Regal Wohnzimmer hinten links · 1 Set"
        show(font = 2f) {
            Column(Modifier.width(360.dp)) {
                FilterSection("Lagerort") {
                    FilterChoice("Alle Lagerorte", true) {}
                    FilterChoice(lang, false) {}
                }
            }
        }
        compose.onNode(hasText("Lagerort") and isHeading()).fetchSemanticsNode("„Lagerort“ ist keine Überschrift")
        for ((text, chosen) in listOf("Alle Lagerorte" to true, lang to false)) {
            val chip = compose.onNode(hasText(text) and hasClickAction()).fetchSemanticsNode()
            assertEquals("$text: role", Role.RadioButton, role(chip))
            assertEquals("$text: selected", chosen, chip.config.getOrNull(SemanticsProperties.Selected))
        }
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.SelectableGroup))
            .fetchSemanticsNode("Die Chips stehen nicht in einer Gruppe")
        val text = compose.onAllNodes(hasText(lang), useUnmergedTree = true).fetchSemanticsNodes()
            .first { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
        assertTrue("chip text cut off at 200 %", !layout(text).hasVisualOverflow)
    }

    @Test
    fun `status messages are live regions and progress is announced throttled`() {
        var progress by mutableStateOf("Noch 30 s")
        show {
            Column {
                CameraOverlay(hint = "Näher heran") { }
                LoadCircle(Modifier.width(48.dp))
                ThrottledAnnouncement(progress)
            }
        }
        val live = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        compose.onNode(hasText("Näher heran") and live, useUnmergedTree = true).fetchSemanticsNode("Scannerhinweis wird nicht angesagt")
        compose.onNode(hasContentDescription(ctx.getString(R.string.common_loading)) and live)
            .fetchSemanticsNode("Laden wird nicht angesagt")
        // The clock by hand: the announcement may change only after ten seconds.
        compose.mainClock.autoAdvance = false
        // On the UI thread and reported immediately: otherwise the change only arrived with the clock,
        // and even an unthrottled announcement still showed the old wording after 5 s.
        compose.runOnUiThread { progress = "Noch 29 s"; Snapshot.sendApplyNotifications() }
        compose.mainClock.advanceTimeBy(5_000)
        compose.onNode(hasContentDescription("Noch 30 s") and live).fetchSemanticsNode("Nach 5 s schon neu angesagt")
        compose.mainClock.advanceTimeBy(6_000)
        compose.onNode(hasContentDescription("Noch 29 s") and live).fetchSemanticsNode("Nach 10 s nicht neu angesagt")
    }

    @Test
    fun `image zoom works with buttons and double tap`() {
        show { ZoomableImageDialog(imageUrl = "", contentDescription = "Millennium Falcon", imageLoader = images, onDismiss = {}) }
        val large = ctx.getString(R.string.pdfview_zoom_in)
        val button = compose.onNodeWithContentDescription(large).fetchSemanticsNode()
        assertEquals(Role.Button, role(button))
        compose.onNodeWithText("100 %").fetchSemanticsNode()
        compose.onNodeWithContentDescription(large).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("150 %").fetchSemanticsNode("Vergrössern wirkt nicht")
        compose.onNodeWithText("150 %").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("100 %").fetchSemanticsNode("Der Faktor setzt nicht zurück")
        compose.onNode(isDialog()).performTouchInput { doubleClick() }
        compose.waitForIdle()
        compose.onNodeWithText("200 %").fetchSemanticsNode("Doppeltipp zoomt nicht")
    }

    @OptIn(ExperimentalComposeUiApi::class)
    @Test
    fun `keyboard focus shows a frame in the primary color`() {
        var mainColor = 0
        val store = FocusRequester()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                mainColor = MaterialTheme.colorScheme.primary.toArgb()
                val mode = LocalInputModeManager.current
                LaunchedEffect(Unit) { mode.requestInputMode(InputMode.Keyboard) }
                Surface(color = MaterialTheme.colorScheme.background) {
                    Column {
                        // In keyboard mode Compose sets the initial focus on the first
                        // focusable; without this decoy the card carried it from the start.
                        Box(Modifier.size(8.dp).focusRequester(store).focusable())
                        AppCard(Modifier.width(200.dp), onClick = {}) { Text("Millennium Falcon", Modifier.width(200.dp)) }
                    }
                }
            }
        }
        compose.waitForIdle()
        val card = compose.onNode(hasClickAction())
        fun edgeColor(): Int {
            val image = card.captureToImage().toPixelMap()
            return image[2, image.height / 2].toArgb()
        }
        compose.runOnIdle { store.requestFocus() }
        compose.waitForIdle()
        assertTrue("a frame already without focus", edgeColor() != mainColor)
        card.performSemanticsAction(SemanticsActions.RequestFocus)
        compose.waitForIdle()
        assertEquals("focus frame is missing", mainColor, edgeColor())
        compose.runOnIdle { store.requestFocus() }
        compose.waitForIdle()
        assertTrue("frame stays after the focus", edgeColor() != mainColor)
    }

    @Test
    fun `CSV bar names state, expanding and progress`() {
        show {
            CsvImportBanner(CsvProgress(done = 3, total = 10, current = "10294-1", ok = 2, warn = 1, err = 0), running = true, onCancel = {})
        }
        val bar = compose.onNode(hasClickAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.StateDescription))
            .fetchSemanticsNode("Der Aufklapper nennt keinen Zustand")
        assertEquals(ctx.getString(R.string.state_collapsed), bar.config[SemanticsProperties.StateDescription])
        assertTrue("without an expand action", bar.config.getOrNull(SemanticsActions.Expand) != null)
        assertEquals(ctx.getString(R.string.csv_details_show), bar.config.getOrNull(SemanticsActions.OnClick)?.label)
        assertTrue("progress with symbols instead of words: ${announced(bar)}", announced(bar).none { '/' in it })
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo,
            ProgressBarRangeInfo(3f, 0f..10f)), useUnmergedTree = true).fetchSemanticsNode("Fortschritt nicht als 3 von 10")
    }

    @Test
    fun `set and catalog tile read the name first and are buttons with a target`() {
        val set = SetView(setNumber = "75192-1", name = "Millennium Falcon", theme = "Star Wars", quantity = 2,
            conditions = listOf(Condition.NEW))
        val catalog = CatalogSetView(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022,
            numParts = 4514, owned = true, ownedQuantity = 2)
        show {
            Column {
                SetCard(set, "", images, onClick = {})
                CatalogSetCard(catalog, imageLoader = images, serverUrl = "", onClick = {})
            }
        }
        val open = ctx.getString(R.string.cd_details_open)
        for (name in listOf("Millennium Falcon", "Lion Knights' Castle")) {
            // Found in the merged tree, read in the unmerged one: the order is there.
            val id = compose.onNode(hasClickAction() and hasText(name, substring = true)).fetchSemanticsNode("Kachel „$name“").id
            val tile = compose.onNode(SemanticsMatcher("Knoten $id") { it.id == id }, useUnmergedTree = true).fetchSemanticsNode()
            val read = announced(tile).filter { it.isNotBlank() }
            assertEquals("$name first: $read", name, read.first())
            assertEquals("$name exactly once: $read", 1, read.count { it == name })
            assertEquals("$name: role", Role.Button, role(tile))
            assertEquals("$name: target", open, tile.config.getOrNull(SemanticsActions.OnClick)?.label)
        }
    }

    @Test
    fun `long titles wrap at 200 percent and are headings`() {
        val title = "Slope 45 2 x 2 with Bottom Pin"
        show(font = 2f) {
            Column(Modifier.width(360.dp)) {
                Subpage(title, remember { SnackbarHostState() }, onBack = {}) { Text("Inhalt") }
            }
        }
        val node = compose.onNode(hasText(title) and isHeading(), useUnmergedTree = true)
            .fetchSemanticsNode("Titel ist keine Überschrift")
        assertTrue("title cut off", !layout(node).hasVisualOverflow)
    }

    @Test
    fun `the confirmation names its title as heading and window name`() {
        show { Prompt("Abmelden?", "Auf diesem Gerät abmelden.", "Abmelden", {}, {}) }
        compose.onNode(hasText("Abmelden?") and isHeading()).fetchSemanticsNode("Titel ist keine Überschrift")
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, "Abmelden?"))
            .fetchSemanticsNode("Dialog ohne Fenstername")
    }

    @Test
    fun `Learn more has its own name per topic and announces the text`() {
        show {
            Column {
                ExplainText("Kurz eins.", "Mehr eins.", theme = "Preisalarme")
                ExplainText("Kurz zwei.", "Mehr zwei.", theme = "Haushalt")
            }
        }
        compose.onNodeWithContentDescription("Mehr zu Preisalarme").fetchSemanticsNode()
        compose.onNodeWithContentDescription("Mehr zu Haushalt").performClick()
        compose.waitForIdle()
        compose.onNode(hasText("Mehr zwei.") and SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
            .fetchSemanticsNode("Der aufgeklappte Text wird nicht angesagt")
        compose.onNodeWithText(ctx.getString(R.string.explain_less)).fetchSemanticsNode("Kein Weg zum Zuklappen")
    }

    @Test
    fun `catalog names are marked as English`() {
        var name: AnnotatedString? = null
        show { name = catalogName("Brick 2 x 4") }
        val languages = name?.spanStyles?.mapNotNull { it.item.localeList?.firstOrNull()?.language }.orEmpty()
        assertEquals(listOf("en"), languages)
    }

    @Test
    fun `emergency codes are read out character by character`() {
        show {
            SecondFactorRequiredMask(SecondFactorUiState(active = true, codes = listOf("i9j0-k1l2")), {}, {}, {}, {})
        }
        compose.onNodeWithContentDescription("i 9 j 0 - k 1 l 2").fetchSemanticsNode("Codes als Wort vorgelesen")
    }
}
