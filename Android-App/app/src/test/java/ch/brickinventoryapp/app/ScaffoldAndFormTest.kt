package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.app.nav.Reiter
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.account.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.model.util.PASSWORD_MIN_CHARS
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ch.brickinventoryapp.ui.components.IMAGE_FALLBACK
import ch.brickinventoryapp.ui.components.AddFab
import ch.brickinventoryapp.ui.components.BrandsHeader
import ch.brickinventoryapp.ui.components.OfflineHint
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.model.domain.BrickLinkView
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.shared.ui.GalleryStatChip
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import ch.brickinventoryapp.shared.ui.partsBreakdown
import ch.brickinventoryapp.shared.ui.MetricsSeries
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.account.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.shared.ui.StatChipV2
import ch.brickinventoryapp.account.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.ui.util.fmtInt
import android.content.Context
import android.os.Looper
import android.provider.Settings
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsNode
import java.util.Locale
import org.robolectric.Shadows
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.collection.ui.SammlungZiel

/**
 * Findings of the tenth and eleventh UI review (Android), executed as behavior: the
 * add button rises above the snackbar, offline a neutral banner stands instead of two
 * contradictory lines, errors in forms are announced, password fields
 * know autofill and eye, admin rights stand under „Erweitert“, the server chip
 * says what it does, the key figures wrap in collection and detail, the catalog detail uses the tablet, and the finances name the market value
 * before the history.
 *
 * Counter-checks (patches under gegenproben/, measured only in CI — Robolectric):
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

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    private fun zeige(schrift: Float = 1f, inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        compose.waitForIdle()
    }

    /** The world responds in ticks; drive the main looper until [fertig] holds. */
    private fun wait(name: String, fertig: () -> Boolean) {
        driveUntil(name, bereit = fertig)
        compose.waitForIdle()
    }

    /** The scaffold with one tab; [inhalt] is the collection page. */
    @Composable
    private fun Scaffold(meldung: SnackbarHostState, offen: Int = 0, inhalt: @Composable () -> Unit) {
        val nav = rememberNavController()
        val tab = remember {
            listOf(
                Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"))
        }
        MainScaffold(
            title = "Sammlung", navController = nav, bottomNavItems = tab,
            snackbarHostState = meldung,
            csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
            onCsvAbbrechen = {}, onTabAngetippt = {}, offeneAenderungen = offen,
        ) {
            NavHost(nav, startDestination = SammlungZiel.Gallery) { composable<SammlungZiel.Gallery> { inhalt() } }
        }
    }

    @Test
    fun `add button rises above the snackbar`() {
        val meldung = SnackbarHostState()
        val erfassen = ctx.getString(R.string.gallery_add_set)
        zeige {
            Scaffold(meldung) {
                Box(Modifier.fillMaxSize()) {
                    AddFab(erfassen, {},
                        Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross))
                }
            }
            LaunchedEffect(Unit) {
                meldung.showSnackbar("Titanic entfernt", actionLabel = "Rückgängig", duration = SnackbarDuration.Indefinite)
            }
        }
        compose.waitForIdle()
        val button = compose.onNodeWithContentDescription(erfassen).fetchSemanticsNode().boundsInRoot
        val snackbar = compose.onNodeWithText("Titanic entfernt").fetchSemanticsNode().boundsInRoot
        assertTrue("Der Knopf steht über der Snackbar ($button / $snackbar)", button.bottom <= snackbar.top)
    }

    @Test
    fun `offline hint names the pending changes in a banner`() {
        zeige {
            Scaffold(remember { SnackbarHostState() }, offen = 3) {
                Column { OfflineHint(1_793_000_000_000L) }
            }
        }
        compose.waitForIdle()
        val warten = ctx.resources.getQuantityString(R.plurals.offline_warten, 3, 3)
        compose.onAllNodesWithText(warten, useUnmergedTree = true).assertCountEquals(1)
        val stand = compose.onNodeWithText(ctx.getString(R.string.offline_stand, ""), substring = true,
            useUnmergedTree = true).fetchSemanticsNode()
        val zeile = compose.onNodeWithText(warten, useUnmergedTree = true).fetchSemanticsNode()
        assertEquals("Stand und wartende Änderungen auf derselben Fläche", stand.parent?.id, zeile.parent?.id)
        assertTrue("Das Banner wird angesagt",
            stand.parent?.config?.contains(SemanticsProperties.LiveRegion) == true)
    }

    @Test
    fun `offline hint offers to fetch the list again`() {
        var geholt = 0
        zeige { Column { OfflineHint(1_793_000_000_000L, onErneut = { geholt++ }) } }
        compose.onNode(hasText(ctx.getString(R.string.common_retry)) and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("Erneut versuchen holt die Liste", 1, geholt)
    }

    @Test
    fun `price alerts show the threshold as an amount and the direction in the choice`() {
        val world = Examples.Welt(ContextTexts())
        try {
            world.paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
                {"set_number":"75192-1","condition":"N","direction":"ueber","threshold":750.0,"currency_code":"CHF"}]}"""
            val vm = world.t.merke(SettingsViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.sync,
                testAccountRepository(world.t.api, world.t.io),
                testManagementRepository(world.t.api), world.t.alerts(),
                testPartsRepository(world.t.api),
                object : FileReader {
                    override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null
                }))
            zeige {
                PreisalarmeRoute(vm = vm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                    snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, reportToggle = {})
            }
            wait("Alarme") { vm.alarmOverview.value.geladen }
            // „750.00“ like every amount (de-CH), not the raw number „750.0“; the field is called „Schwelle“,
            // the direction stands selected in the choice above (N2 of the second UX review). „Steigt
            // über“, because the creation form preselects „Fällt unter“.
            compose.onNode(hasSetTextAction() and hasText("750.00")).fetchSemanticsNode()
            compose.onNode(hasSetTextAction() and hasText("750.00") and hasText(ctx.getString(R.string.alerts_schwelle)))
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
        val fehler = listOf("Benutzername oder Passwort falsch", "Das aktuelle Passwort stimmt nicht", "Der Code stimmt nicht")
        zeige {
            when (fall.intValue) {
                0 -> LoginScreen(
                    serverUrl = "https://brick.example.org", isLoading = false, error = fehler[0], codeNoetig = false,
                    formular = AnmeldeFormular.ANMELDEN, registrierungOffen = false, kontoLaeuft = false,
                    kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> },
                    onFormular = {}, onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
                )
                1 -> StartPasswordMask(AccountUiState(speichern = Vorgang.Fehlgeschlagen(Meldung.Text(fehler[1]))), { _, _, _ -> }, {})
                else -> ZweiterFaktorPflichtMaske(
                    ZweiterFaktorUiState(aktiv = false, abruf = Laden.Fehler(Fehlerklasse.SERVER, Meldung.Text(fehler[2]))),
                    {}, {}, {}, {})
            }
        }
        val angesagt = SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion)
        fehler.forEachIndexed { i, text ->
            fall.intValue = i
            compose.waitForIdle()
            compose.onNode(hasText(text) and angesagt, useUnmergedTree = true).fetchSemanticsNode("„$text“ wird nicht angesagt")
        }
    }

    /** The autofill kind of a field: the value of its semantics that is a ContentType. */
    private fun autofill(node: SemanticsNode): Any? =
        node.config.firstOrNull { it.value is ContentType }?.value

    @Test
    fun `start password form fills passwords automatically and shows them on request`() {
        zeige { StartPasswordMask(AccountUiState(), { _, _, _ -> }, {}) }
        val felder = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes()
        assertEquals("Aktuelles, neues und wiederholtes Passwort",
            listOf(ContentType.Password, ContentType.NewPassword, ContentType.NewPassword), felder.map(::autofill))
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.cd_password_show)).assertCountEquals(3)
        // The minimum length stands there before typing.
        compose.onNodeWithText(ctx.resources.getQuantityString(R.plurals.passwort_mindestens, PASSWORD_MIN_CHARS, PASSWORD_MIN_CHARS)).fetchSemanticsNode()
    }

    @Test
    fun `start password form stands in reading width on the tablet`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige { StartPasswordMask(AccountUiState(), { _, _, _ -> }, {}) }
        val dichte = ctx.resources.displayMetrics.density
        val feld = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
        assertTrue("Feld ${feld.width / dichte} dp breit", feld.width / dichte <= 561f)
    }

    /** Account and price alerts are forms: reading width, and the amount field stays narrow. */
    @Test
    fun `account and price alerts stand in form width on the tablet`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val world = Examples.Welt(ContextTexts())
        try {
            world.paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
                {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF","name":"Millennium Falcon"}]}"""
            val vm = world.t.merke(SettingsViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.sync,
                testAccountRepository(world.t.api, world.t.io),
                testManagementRepository(world.t.api), world.t.alerts(),
                testPartsRepository(world.t.api),
                object : FileReader {
                    override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null
                }))
            zeige {
                PreisalarmeRoute(vm = vm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                    snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, reportToggle = {})
            }
            wait("Alarme") { vm.alarmOverview.value.geladen }
            val dichte = ctx.resources.displayMetrics.density
            val feld = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
            // Centered on 560 dp the card starts at 360 dp; in list width (840 dp) already at 220.
            assertTrue("Die Karte steht in Formularbreite (Feld ab ${feld.left / dichte} dp)", feld.left / dichte >= 340f)
            assertTrue("Das Betragsfeld ist ${feld.width / dichte} dp breit", feld.width / dichte <= 321f)
        } finally {
            world.close()
        }
    }

    /** In landscape hint and action stand side by side: „Weiter“ visible without scrolling. */
    @Test
    fun `setup in landscape shows Next without scrolling`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige { SetupScreen(currentUrl = "http://nas:3000", onSave = {}, entwicklung = false) }
        val hoehe = compose.onRoot().fetchSemanticsNode().boundsInRoot.height
        // Measured unclipped: boundsInRoot would cut off a button below the fold at the edge.
        val weiter = compose.onNode(hasText(ctx.getString(R.string.setup_continue)) and hasClickAction()).fetchSemanticsNode()
        val unten = weiter.positionInRoot.y + weiter.size.height
        assertTrue("Weiter endet bei $unten von $hoehe", unten <= hoehe)
    }

    /** At 200 % the brand header stands small in one line; the first field stays at the top. */
    @Test
    fun `brand header at 200 percent takes at most an eighth of the height`() {
        zeige(schrift = 2f) { BrandsHeader() }
        val dichte = ctx.resources.displayMetrics.density
        val kopf = compose.onNodeWithText(ctx.getString(R.string.app_name)).fetchSemanticsNode().boundsInRoot
        assertTrue("Markenkopf endet erst bei ${kopf.bottom / dichte} dp", kopf.bottom / dichte <= 891f / 8)
    }

    /** „Animationen entfernen“ (animator duration 0) is read; otherwise motion applies. */
    @Test
    fun `reduced motion follows the system's animator duration`() {
        val resolution = ctx.contentResolver
        Settings.Global.putFloat(resolution, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        var ruhig: Boolean? = null
        zeige { ruhig = movementReduced() }
        assertEquals("Mit Animator-Dauer 0 ruht alles", true, ruhig)
        Settings.Global.putFloat(resolution, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    }

    /** Switched in the system settings while the app is open; the motion follows immediately. */
    @Test
    fun `reduced motion follows a change at runtime`() {
        val resolution = ctx.contentResolver
        val dauer = Settings.Global.ANIMATOR_DURATION_SCALE
        Settings.Global.putFloat(resolution, dauer, 1f)
        var ruhig: Boolean? = null
        zeige { ruhig = movementReduced() }
        assertEquals("Mit Animator-Dauer 1 bewegt sich alles", false, ruhig)
        try {
            Settings.Global.putFloat(resolution, dauer, 0f)
            resolution.notifyChange(Settings.Global.getUriFor(dauer), null)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            compose.waitForIdle()
            assertEquals("Nach dem Umstellen ruht alles", true, ruhig)
        } finally {
            Settings.Global.putFloat(resolution, dauer, 1f)
        }
    }

    /** The main button stays tappable; empty it marks the first field and puts the cursor into it. */
    @Test
    fun `start password form marks on submit what is missing and focuses the first field`() {
        var ersetzt = 0
        zeige { StartPasswordMask(AccountUiState(), { _, _, _ -> ersetzt++ }, {}) }
        val button = compose.onNode(hasText(ctx.getString(R.string.konto_password_button)) and hasClickAction())
        button.assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals("Leer wird nichts abgeschickt", 0, ersetzt)
        compose.onNodeWithText(ctx.getString(R.string.login_password_fehlt)).fetchSemanticsNode()
        compose.onAllNodes(hasSetTextAction())[0].assertIsFocused()
        val felder = compose.onAllNodes(hasSetTextAction())
        felder[0].performTextInput("altes-passwort-1")
        felder[1].performTextInput("neues-passwort-12")
        felder[2].performTextInput("neues-passwort-12")
        button.performClick()
        compose.waitForIdle()
        assertEquals("Vollständig geht es ab", 1, ersetzt)
        compose.onAllNodesWithText(ctx.getString(R.string.login_password_fehlt)).assertCountEquals(0)
    }

    @Test
    fun `admin rights stand collapsed under Advanced`() {
        zeige {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = false, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> },
                onFormular = {}, onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
        val voll = ctx.getString(R.string.login_full_access)
        compose.onAllNodesWithText(voll, substring = true).assertCountEquals(0)
        compose.onNode(hasText(ctx.getString(R.string.login_erweitert)) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onAllNodesWithText(voll, substring = true).assertCountEquals(1)
    }

    private val metrics = listOf(12 to R.plurals.gallery_stat_sets, 15 to R.plurals.gallery_stat_units,
        9090 to R.plurals.gallery_stat_parts, 22 to R.plurals.gallery_stat_minifigs, 4 to R.plurals.gallery_stat_instructions)

    @Test
    fun `collection key figures wrap at 200 percent and stay fully visible`() {
        zeige(schrift = 2f) {
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
            assertTrue("„$text“ ragt über den Rand ($b, Rand $edge)", b.right <= edge + 1f && b.width > 0f)
        }
    }

    /** „82 Teile (42 aus Sets · 40 einzeln)“: at 200 % the bracket stands on its own line and never breaks between number and word. */
    @Test
    fun `parts breakdown does not break between number and word at 200 percent`() {
        zeige(schrift = 2f) {
            Box(Modifier.width(360.dp)) {
                MetricsSeries { GalleryStatChip(82, R.plurals.gallery_stat_parts, partsBreakdown(42, 40)) }
            }
        }
        val haupt = ctx.resources.getQuantityString(R.plurals.gallery_stat_parts, 82, "82")
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNode(hasText(haupt, substring = true), useUnmergedTree = true).fetchSemanticsNode()
            .config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        val l = layouts.single()
        val text = l.layoutInput.text.text
        fun zeile(place: Int) = l.getLineForOffset(place)
        val bracket = text.indexOf('(')
        assertTrue("Klammer beginnt eine Zeile: „$text“", bracket >= 0 && l.getLineStart(zeile(bracket)) == bracket)
        Regex("""\d+[\s\u00A0]\p{L}+""").findAll(text.substring(bracket)).forEach { m ->
            val von = bracket + m.range.first
            assertEquals("„${m.value}“ bricht um in „$text“", zeile(von), zeile(bracket + m.range.last))
        }
    }

    @Test
    fun `key figures in the detail wrap at 200 percent and stay fully visible`() {
        val werte = listOf(ctx.getString(R.string.detail_year) to "2017", ctx.getString(R.string.detail_minifigs) to "7",
            ctx.getString(R.string.detail_theme) to "Star Wars")
        zeige(schrift = 2f) {
            Box(Modifier.width(360.dp)) {
                MetricsSeries {
                    werte.forEach { (label, wert) -> StatChipV2(label, wert) }
                }
            }
        }
        val edge = 360f * ctx.resources.displayMetrics.density
        werte.forEach { (label, wert) ->
            val b = compose.onNodeWithText("$label $wert", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("„$label $wert“ ragt über den Rand ($b, Rand $edge)", b.right <= edge + 1f && b.width > 0f)
        }
    }

    /**
     * Offline is not an error (the changes are saved): the banner's surface
     * is not red. Measured on the image, a spot inside at the right edge.
     */
    @Test
    fun `offline hint reports no error with a red surface`() {
        zeige {
            Scaffold(remember { SnackbarHostState() }, offen = 3) {
                Column { OfflineHint(1_793_000_000_000L) }
            }
        }
        val warten = ctx.resources.getQuantityString(R.plurals.offline_warten, 3, 3)
        val bild = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion) and
            hasAnyDescendant(hasText(warten)), useUnmergedTree = true).captureToImage().toPixelMap()
        val p = bild[bild.width - 12, bild.height / 2]
        assertTrue("Banner-Fläche rötlich: $p", p.red - p.blue < 0.08f)
    }

    /** The chip above the sign-in switches the server: TalkBack hears that as a button. */
    @Test
    fun `server chip names its task as a button`() {
        var geaendert = 0
        zeige(schrift = 2f) {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = false, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> },
                onFormular = {}, onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = { geaendert++ },
            )
        }
        val chip = compose.onNodeWithContentDescription(ctx.getString(R.string.login_server_aendern, "https://brick.example.org"))
        assertEquals(Role.Button, chip.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Role))
        chip.performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp öffnet den Serverwechsel", 1, geaendert)
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
        zeige {
            CatalogDetailScreen(setNumber = "10305-1", geladen = Laden.Daten(catalogDetail),
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "", onLoad = {},
                onAddToGallery = {}, onWish = {},
                onOpenInGallery = {}, onBack = {})
        }
        val dichte = ctx.resources.displayMetrics.density
        val jahr = compose.onNodeWithText(ctx.getString(R.string.catalog_detail_year)).fetchSemanticsNode().boundsInRoot
        val wert = compose.onNodeWithText("2022").fetchSemanticsNode().boundsInRoot
        val zeile = (wert.right - jahr.left) / dichte
        assertTrue("Bezeichnung und Wert über $zeile dp", zeile <= Lesebreite.wertzeile.value + 1f)
        val aufnehmen = compose.onNode(hasText(ctx.getString(R.string.catalog_add_to_gallery)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Knopf ${aufnehmen.width / dichte} dp breit",
            aufnehmen.width / dichte <= Lesebreite.controls.value + 1f)
        compose.onNodeWithText(fmtInt(4514)).fetchSemanticsNode()
    }

    @Test
    fun `catalog detail stands in two columns on the tablet, add before BrickLink`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige {
            CatalogDetailScreen(setNumber = "10305-1", geladen = Laden.Daten(catalogDetail),
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "", onLoad = {},
                onAddToGallery = {}, onWish = {},
                onOpenInGallery = {}, onBack = {})
        }
        // The name stands once, in the bar as in the set detail; the details to the right of the image.
        compose.onAllNodesWithText("Lion Knights' Castle").assertCountEquals(1)
        val nummer = compose.onNodeWithText("10305-1").fetchSemanticsNode().boundsInRoot
        val bild = compose.onNode(hasTestTag(IMAGE_FALLBACK), useUnmergedTree = true)
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Die Angaben stehen rechts vom Bild ($bild / $nummer)", nummer.left >= bild.right)
        val dichte = ctx.resources.displayMetrics.density
        assertTrue("Das Bild bleibt bei höchstens 480 dp (${bild.width / dichte})", bild.width <= 481 * dichte)
        val aufnehmen = compose.onNode(hasText(ctx.getString(R.string.catalog_add_to_gallery)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        val bricklink = compose.onNode(hasText(ctx.getString(R.string.catalog_buy_bricklink)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Die eigene Handlung steht vor dem Weg nach draussen", aufnehmen.bottom <= bricklink.top)
    }

    @Test
    fun `finances name the market value before the history`() {
        val world = Examples.Welt(ContextTexts())
        try {
            val vm = world.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            zeige { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            wait("Finanzen") { vm.financeState.value.let { it.valuation != null && !it.bewertung.laedt && !it.verlauf.laedt } }
            val kopf = compose.onNodeWithText(ctx.getString(R.string.finance_market_avg), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot
            val verlauf = compose.onNodeWithText(ctx.getString(R.string.chart_portfolio_value), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot
            assertTrue("Kopfkachel ($kopf) vor dem Verlauf ($verlauf)", kopf.bottom <= verlauf.top)
        } finally {
            world.close()
        }
    }
}
