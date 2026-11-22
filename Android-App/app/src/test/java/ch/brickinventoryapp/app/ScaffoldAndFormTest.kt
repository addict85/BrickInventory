package ch.brickinventoryapp.app

import android.content.Context
import android.os.Looper
import android.provider.Settings
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.account.ui.screens.PriceAlarmsRoute
import ch.brickinventoryapp.account.ui.screens.SecondFactorRequiredMask
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.app.nav.Tab
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailActions
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.login.ui.screens.LoginActions
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.LoginScreenState
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.model.domain.BrickLinkView
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.util.PASSWORD_MIN_CHARS
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.GalleryStatChip
import ch.brickinventoryapp.shared.ui.MetricsSeries
import ch.brickinventoryapp.shared.ui.StatChipV2
import ch.brickinventoryapp.shared.ui.partsBreakdown
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.BrandsHeader
import ch.brickinventoryapp.ui.components.IMAGE_FALLBACK
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.fmtInt
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Findings of the tenth and eleventh UI review (Android), executed as behavior: the
 * add button rises above the snackbar, offline a neutral banner stands instead of two
 * contradictory lines, errors in forms are announced, password fields
 * know autofill and eye, admin rights stand under „Erweitert“, the server chip
 * says what it does, the key figures wrap in collection and detail, the catalog detail uses the tablet, and the finances name the market value
 * before the history.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   fab-unter-snackbar          AddFab without distance to the snackbar → red “add button rises …”
 *   offline-zwei-zeilen         outbox bar also next to the offline hint → red “offline hint names …”
 *   preisalarm-rohzahl          threshold again as „750.0“ → red “price alerts show the threshold …”
 *   fehler-ohne-ansage          ansagen() without live region → red “errors of the sign-in …”
 *   passwortfeld-ohne-autofill  PasswordField without contentType → red “start password form fills …”
 *   startpasswort-volle-breite  form without reading width → red “start password form stands in reading width …”
 *   verwalterrechte-offen       „Erweitert“ open from the start → red “admin rights stand collapsed …”
 *   kennzahlen-ohne-umbruch     key figures in a Row instead of FlowRow → red “collection key figures …”
 *   offline-in-fehlerrot        banner again in tertiaryContainer (Classic: red) → red “offline hint reports …”
 *   server-chip-ohne-aufgabe    chip without description → red “server chip names …”
 *   katalog-einspaltig          catalog detail single-column on the tablet too → red “catalog detail stands …”
 *   finanzen-verlauf-zuerst     history again before the header tile → red “finances name the market value …”
 *   katalog-bild-ohne-grenze    catalog image again without maximum width → red “catalog detail stands …”
 *   alarme-volle-breite         price alerts again in list width → red “account and price alerts …”
 *   alarm-feld-tablet-breit     fields of an alert also fill the tablet card → red “account and price alerts …”
 *   markenkopf-immer-gross      brand header large at 200 % too → red “brand header at 200 percent …”
 *   bewegung-immer-an           movementReduced() always returns false → red “reduced motion …”
 *   einrichtung-einspaltig      setup single-column in landscape too → red “setup in landscape …”
 *   detailzeile-volle-breite    detail row without reading width → red “detail cards stand in reading width …”
 *   bewegung-ohne-beobachter    setting read only once → red “reduced motion follows a change …”
 *   startpasswort-ohne-pruefung button submits without check → red “start password form marks …”
 *   offline-ohne-handlung       banner without „Erneut versuchen“ → red “offline hint offers …”
 *   aufschluesselung-bricht     breakdown again with a space in the same line → red
 *                               “parts breakdown does not break between number and word at 200 percent …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class ScaffoldAndFormTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

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

    /** The world responds in ticks; drive the main looper until [done] holds. */
    private fun wait(name: String, done: () -> Boolean) {
        driveUntil(name, ready = done)
        compose.waitForIdle()
    }

    /** The scaffold with one tab; [content] is the collection page. */
    @Composable
    private fun Scaffold(message: SnackbarHostState, open: Int = 0, content: @Composable () -> Unit) {
        val nav = rememberNavController()
        val tab = remember {
            listOf(
                Tab(CollectionTarget.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"))
        }
        MainScaffold(
            title = "Sammlung", navController = nav, bottomNavItems = tab,
            snackbarHostState = message,
            onTabTapped = {}, pendingChanges = open,
        ) {
            NavHost(nav, startDestination = CollectionTarget.Gallery) { composable<CollectionTarget.Gallery> { content() } }
        }
    }

    @Test
    fun `add button rises above the snackbar`() {
        val message = SnackbarHostState()
        val record = ctx.getString(R.string.gallery_add_set)
        show {
            Scaffold(message) {
                Box(Modifier.fillMaxSize()) {
                    AddFab(record, {},
                        Modifier.align(Alignment.BottomEnd).padding(Spacing.large))
                }
            }
            LaunchedEffect(Unit) {
                message.showSnackbar("Titanic entfernt", actionLabel = "Rückgängig", duration = SnackbarDuration.Indefinite)
            }
        }
        compose.waitForIdle()
        val button = compose.onNodeWithContentDescription(record).fetchSemanticsNode().boundsInRoot
        val snackbar = compose.onNodeWithText("Titanic entfernt").fetchSemanticsNode().boundsInRoot
        assertTrue("the button stands above the snackbar ($button / $snackbar)", button.bottom <= snackbar.top)
    }

    @Test
    fun `offline hint names the pending changes in a banner`() {
        show {
            Scaffold(remember { SnackbarHostState() }, open = 3) {
                Column { OfflineHint(1_793_000_000_000L) }
            }
        }
        compose.waitForIdle()
        val wait = ctx.resources.getQuantityString(R.plurals.offline_wait, 3, 3)
        compose.onAllNodesWithText(wait, useUnmergedTree = true).assertCountEquals(1)
        val state = compose.onNodeWithText(ctx.getString(R.string.offline_state, ""), substring = true,
            useUnmergedTree = true).fetchSemanticsNode()
        val row = compose.onNodeWithText(wait, useUnmergedTree = true).fetchSemanticsNode()
        assertEquals("status and pending changes on the same surface", state.parent?.id, row.parent?.id)
        assertTrue("the banner is announced",
            state.parent?.config?.contains(SemanticsProperties.LiveRegion) == true)
    }

    @Test
    fun `offline hint offers to fetch the list again`() {
        var fetched = 0
        show { Column { OfflineHint(1_793_000_000_000L, onAgain = { fetched++ }) } }
        compose.onNode(hasText(ctx.getString(R.string.common_retry)) and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("retry fetches the list", 1, fetched)
    }

    @Test
    fun `price alerts show the threshold as an amount and the direction in the choice`() {
        val world = Examples.World(ContextTexts())
        try {
            world.paths.responses["/api/v2/alerts"] = """{"success":true,"alerts":[
                {"set_number":"75192-1","condition":"N","direction":"above","threshold":750.0,"currency_code":"CHF"}]}"""
            val vm = world.t.track(SettingsViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.sync,
                testAccountRepository(world.t.api, world.t.io),
                testManagementRepository(world.t.api), world.t.alerts(),
                testPartsRepository(world.t.api),
                object : FileReader {
                    override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
                }))
            show {
                PriceAlarmsRoute(vm = vm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                    snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onBack = {}, reportToggle = {})
            }
            wait("alerts") { vm.alarmOverview.value.loaded }
            // „750.00“ like every amount (de-CH), not the raw number „750.0“; the field is called „Schwelle“,
            // the direction stands selected in the choice above (N2 of the second UX review). „Steigt über“
            // , because the creation form preselects „Fällt unter“.
            compose.onNode(hasSetTextAction() and hasText("750.00")).fetchSemanticsNode()
            compose.onNode(hasSetTextAction() and hasText("750.00") and hasText(ctx.getString(R.string.alerts_threshold)))
                .fetchSemanticsNode()
            compose.onNode(hasText(ctx.getString(R.string.detail_alert_chip_above)) and isSelected()).fetchSemanticsNode()
            // No own save button: saving happens on typing as in the set detail.
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.settings_save)).assertCountEquals(0)
        } finally {
            world.close()
        }
    }

    @Test
    fun `errors of the sign-in and of the mandatory forms are announced`() {
        val fall = mutableIntStateOf(0)
        val error = listOf("Benutzername oder Passwort falsch", "Das aktuelle Passwort stimmt nicht", "Der Code stimmt nicht")
        show {
            when (fall.intValue) {
                0 -> LoginScreen(
                    LoginScreenState(serverUrl = "https://brick.example.org", login = Operation.Failed(Message.Text(error[0])),
                        registrationOpen = false),
                    object : LoginActions {},
                )
                1 -> StartPasswordMask(AccountUiState(save = Operation.Failed(Message.Text(error[1]))), { _, _, _ -> }, {})
                else -> SecondFactorRequiredMask(
                    SecondFactorUiState(active = false, fetch = Load.Failure(ErrorClass.SERVER, Message.Text(error[2]))),
                    {}, {}, {}, {})
            }
        }
        val announced = SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion)
        error.forEachIndexed { i, text ->
            fall.intValue = i
            compose.waitForIdle()
            compose.onNode(hasText(text) and announced, useUnmergedTree = true).fetchSemanticsNode("„$text“ wird nicht angesagt")
        }
    }

    /** The autofill kind of a field: the value of its semantics that is a ContentType. */
    private fun autofill(node: SemanticsNode): Any? =
        node.config.firstOrNull { it.value is ContentType }?.value

    @Test
    fun `start password form fills passwords automatically and shows them on request`() {
        show { StartPasswordMask(AccountUiState(), { _, _, _ -> }, {}) }
        val fields = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes()
        assertEquals("current, new and repeated password",
            listOf(ContentType.Password, ContentType.NewPassword, ContentType.NewPassword), fields.map(::autofill))
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.cd_password_show)).assertCountEquals(3)
        // The minimum length stands there before typing.
        compose.onNodeWithText(ctx.resources.getQuantityString(R.plurals.password_at_least, PASSWORD_MIN_CHARS, PASSWORD_MIN_CHARS)).fetchSemanticsNode()
    }

    @Test
    fun `start password form stands in reading width on the tablet`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        show { StartPasswordMask(AccountUiState(), { _, _, _ -> }, {}) }
        val density = ctx.resources.displayMetrics.density
        val field = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
        assertTrue("field ${field.width / density} dp wide", field.width / density <= 561f)
    }

    /** Account and price alerts are forms: reading width, and the amount field stays narrow. */
    @Test
    fun `account and price alerts stand in form width on the tablet`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val world = Examples.World(ContextTexts())
        try {
            world.paths.responses["/api/v2/alerts"] = """{"success":true,"alerts":[
                {"set_number":"75192-1","condition":"N","direction":"below","threshold":750.0,"currency_code":"CHF","name":"Millennium Falcon"}]}"""
            val vm = world.t.track(SettingsViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.sync,
                testAccountRepository(world.t.api, world.t.io),
                testManagementRepository(world.t.api), world.t.alerts(),
                testPartsRepository(world.t.api),
                object : FileReader {
                    override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
                }))
            show {
                PriceAlarmsRoute(vm = vm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                    snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onBack = {}, reportToggle = {})
            }
            wait("alerts") { vm.alarmOverview.value.loaded }
            val density = ctx.resources.displayMetrics.density
            val field = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
            // Centered on 560 dp the card starts at 360 dp; in list width (840 dp) already at 220.
            assertTrue("the card stands in form width (field from ${field.left / density} dp)", field.left / density >= 340f)
            assertTrue("the amount field is ${field.width / density} dp wide", field.width / density <= 321f)
        } finally {
            world.close()
        }
    }

    /** In landscape hint and action stand side by side: „Weiter“ visible without scrolling. */
    @Test
    fun `setup in landscape shows Next without scrolling`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        show { SetupScreen(currentUrl = "http://nas:3000", onSave = {}, development = false) }
        val height = compose.onRoot().fetchSemanticsNode().boundsInRoot.height
        // Measured unclipped: boundsInRoot would cut off a button below the fold at the edge.
        val next = compose.onNode(hasText(ctx.getString(R.string.setup_continue)) and hasClickAction()).fetchSemanticsNode()
        val bottom = next.positionInRoot.y + next.size.height
        assertTrue("next ends at $bottom of $height", bottom <= height)
    }

    /** At 200 % the brand header stands small in one line; the first field stays at the top. */
    @Test
    fun `brand header at 200 percent takes at most an eighth of the height`() {
        show(font = 2f) { BrandsHeader() }
        val density = ctx.resources.displayMetrics.density
        val header = compose.onNodeWithText(ctx.getString(R.string.app_name)).fetchSemanticsNode().boundsInRoot
        assertTrue("brand header only ends at ${header.bottom / density} dp", header.bottom / density <= 891f / 8)
    }

    /** „Animationen entfernen“ (animator duration 0) is read; otherwise motion applies. */
    @Test
    fun `reduced motion follows the system's animator duration`() {
        val resolution = ctx.contentResolver
        Settings.Global.putFloat(resolution, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        var calm: Boolean? = null
        show { calm = movementReduced() }
        assertEquals("with animator duration 0 everything rests", true, calm)
        Settings.Global.putFloat(resolution, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    }

    /** Switched in the system settings while the app is open; the motion follows immediately. */
    @Test
    fun `reduced motion follows a change at runtime`() {
        val resolution = ctx.contentResolver
        val duration = Settings.Global.ANIMATOR_DURATION_SCALE
        Settings.Global.putFloat(resolution, duration, 1f)
        var calm: Boolean? = null
        show { calm = movementReduced() }
        assertEquals("with animator duration 1 everything moves", false, calm)
        try {
            Settings.Global.putFloat(resolution, duration, 0f)
            resolution.notifyChange(Settings.Global.getUriFor(duration), null)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            compose.waitForIdle()
            assertEquals("after switching everything rests", true, calm)
        } finally {
            Settings.Global.putFloat(resolution, duration, 1f)
        }
    }

    /** The main button stays tappable; empty it marks the first field and puts the cursor into it. */
    @Test
    fun `start password form marks on submit what is missing and focuses the first field`() {
        var replaced = 0
        show { StartPasswordMask(AccountUiState(), { _, _, _ -> replaced++ }, {}) }
        val button = compose.onNode(hasText(ctx.getString(R.string.account_password_button)) and hasClickAction())
        button.assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals("empty, nothing is sent", 0, replaced)
        compose.onNodeWithText(ctx.getString(R.string.login_password_missing)).fetchSemanticsNode()
        compose.onAllNodes(hasSetTextAction())[0].assertIsFocused()
        val fields = compose.onAllNodes(hasSetTextAction())
        fields[0].performTextInput("altes-passwort-1")
        fields[1].performTextInput("neues-passwort-12")
        fields[2].performTextInput("neues-passwort-12")
        button.performClick()
        compose.waitForIdle()
        assertEquals("complete, it goes out", 1, replaced)
        compose.onAllNodesWithText(ctx.getString(R.string.login_password_missing)).assertCountEquals(0)
    }

    @Test
    fun `admin rights stand collapsed under Advanced`() {
        show {
            LoginScreen(
                LoginScreenState(serverUrl = "https://brick.example.org", registrationOpen = false),
                object : LoginActions {},
            )
        }
        val full = ctx.getString(R.string.login_full_access)
        compose.onAllNodesWithText(full, substring = true).assertCountEquals(0)
        compose.onNode(hasText(ctx.getString(R.string.login_extended)) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onAllNodesWithText(full, substring = true).assertCountEquals(1)
    }

    private val metrics = listOf(12 to R.plurals.gallery_stat_sets, 15 to R.plurals.gallery_stat_units,
        9090 to R.plurals.gallery_stat_parts, 22 to R.plurals.gallery_stat_minifigs, 4 to R.plurals.gallery_stat_instructions)

    @Test
    fun `collection key figures wrap at 200 percent and stay fully visible`() {
        show(font = 2f) {
            Box(Modifier.width(360.dp)) {
                MetricsSeries {
                    metrics.forEach { (n, id) -> GalleryStatChip(n, id) }
                }
            }
        }
        val edge = 360f * ctx.resources.displayMetrics.density
        metrics.forEach { (n, id) ->
            val text = ctx.resources.getQuantityString(id, n, fmtInt(n))
            val b = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("“$text” sticks out over the edge ($b, edge $edge)", b.right <= edge + 1f && b.width > 0f)
        }
    }

    /** „82 Teile (42 aus Sets · 40 einzeln)“: at 200 % the bracket stands on its own line and never breaks between number and word. */
    @Test
    fun `parts breakdown does not break between number and word at 200 percent`() {
        show(font = 2f) {
            Box(Modifier.width(360.dp)) {
                MetricsSeries { GalleryStatChip(82, R.plurals.gallery_stat_parts, partsBreakdown(42, 40)) }
            }
        }
        val main = ctx.resources.getQuantityString(R.plurals.gallery_stat_parts, 82, "82")
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNode(hasText(main, substring = true), useUnmergedTree = true).fetchSemanticsNode()
            .config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        val l = layouts.single()
        val text = l.layoutInput.text.text
        fun row(place: Int) = l.getLineForOffset(place)
        val bracket = text.indexOf('(')
        assertTrue("a bracket starts a line: “$text”", bracket >= 0 && l.getLineStart(row(bracket)) == bracket)
        Regex("""\d+[\s\u00A0]\p{L}+""").findAll(text.substring(bracket)).forEach { m ->
            val of = bracket + m.range.first
            assertEquals("“${m.value}” wraps in “$text”", row(of), row(bracket + m.range.last))
        }
    }

    @Test
    fun `key figures in the detail wrap at 200 percent and stay fully visible`() {
        val values = listOf(ctx.getString(R.string.detail_year) to "2017", ctx.getString(R.string.detail_minifigs) to "7",
            ctx.getString(R.string.detail_theme) to "Star Wars")
        show(font = 2f) {
            Box(Modifier.width(360.dp)) {
                MetricsSeries {
                    values.forEach { (label, value) -> StatChipV2(label, value) }
                }
            }
        }
        val edge = 360f * ctx.resources.displayMetrics.density
        values.forEach { (label, value) ->
            val b = compose.onNodeWithText("$label $value", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("“$label $value” sticks out over the edge ($b, edge $edge)", b.right <= edge + 1f && b.width > 0f)
        }
    }

    /**
     * Offline is not an error (the changes are saved): the banner's surface
     * is not red. Measured on the image, a spot inside at the right edge.
     */
    @Test
    fun `offline hint reports no error with a red surface`() {
        show {
            Scaffold(remember { SnackbarHostState() }, open = 3) {
                Column { OfflineHint(1_793_000_000_000L) }
            }
        }
        val wait = ctx.resources.getQuantityString(R.plurals.offline_wait, 3, 3)
        val image = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion) and
            hasAnyDescendant(hasText(wait)), useUnmergedTree = true).captureToImage().toPixelMap()
        val p = image[image.width - 12, image.height / 2]
        assertTrue("banner area reddish: $p", p.red - p.blue < 0.08f)
    }

    /** The chip above the sign-in switches the server: TalkBack hears that as a button. */
    @Test
    fun `server chip names its task as a button`() {
        var changed = 0
        show(font = 2f) {
            LoginScreen(
                LoginScreenState(serverUrl = "https://brick.example.org", registrationOpen = false),
                object : LoginActions {
                    override fun changeServer() { changed++ }
                },
            )
        }
        val chip = compose.onNodeWithContentDescription(ctx.getString(R.string.login_server_edit, "https://brick.example.org"))
        assertEquals(Role.Button, chip.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Role))
        chip.performClick()
        compose.waitForIdle()
        assertEquals("a tap opens the server switch", 1, changed)
    }

    private val catalogDetail = CatalogDetailView(
        setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
        numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
        bricklink = BrickLinkView(number = "10305-1",
            url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))

    /**
     * On the tablet label and value stand close together and the buttons in
     * operating width; the parts count carries the thousands separator as everywhere.
     */
    @Test
    fun `detail cards stand in reading width on the tablet`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        show {
            CatalogDetailScreen(setNumber = "10305-1", loaded = Load.Data(catalogDetail), imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                actions = object : CatalogDetailActions {})
        }
        val density = ctx.resources.displayMetrics.density
        val year = compose.onNodeWithText(ctx.getString(R.string.catalog_detail_year)).fetchSemanticsNode().boundsInRoot
        val value = compose.onNodeWithText("2022").fetchSemanticsNode().boundsInRoot
        val row = (value.right - year.left) / density
        assertTrue("label and value over $row dp", row <= ReadingWidth.valueRow.value + 1f)
        val take = compose.onNode(hasText(ctx.getString(R.string.catalog_add_to_gallery)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("button ${take.width / density} dp wide",
            take.width / density <= ReadingWidth.controls.value + 1f)
        compose.onNodeWithText(fmtInt(4514)).fetchSemanticsNode()
    }

    @Test
    fun `catalog detail stands in two columns on the tablet, add before BrickLink`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        show {
            CatalogDetailScreen(setNumber = "10305-1", loaded = Load.Data(catalogDetail), imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                actions = object : CatalogDetailActions {})
        }
        // The name stands once, in the bar as in the set detail; the details to the right of the image.
        compose.onAllNodesWithText("Lion Knights' Castle").assertCountEquals(1)
        val number = compose.onNodeWithText("10305-1").fetchSemanticsNode().boundsInRoot
        val image = compose.onNode(hasTestTag(IMAGE_FALLBACK), useUnmergedTree = true)
            .fetchSemanticsNode().boundsInRoot
        assertTrue("the details stand right of the image ($image / $number)", number.left >= image.right)
        val density = ctx.resources.displayMetrics.density
        assertTrue("the image stays at most 480 dp (${image.width / density})", image.width <= 481 * density)
        val take = compose.onNode(hasText(ctx.getString(R.string.catalog_add_to_gallery)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        val bricklink = compose.onNode(hasText(ctx.getString(R.string.catalog_buy_bricklink)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("one's own action stands before the way out", take.bottom <= bricklink.top)
    }

    @Test
    fun `finances name the market value before the history`() {
        val world = Examples.World(ContextTexts())
        try {
            val vm = world.finances().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            show { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("finances") { vm.financeState.value.let { it.valuation != null && !it.valuationLoad.loading && !it.history.loading } }
            val header = compose.onNodeWithText(ctx.getString(R.string.finance_market_avg), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot
            val history = compose.onNodeWithText(ctx.getString(R.string.chart_portfolio_value), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot
            assertTrue("header tile ($header) before the history ($history)", header.bottom <= history.top)
        } finally {
            world.close()
        }
    }
}
