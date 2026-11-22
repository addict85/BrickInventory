package ch.brickinventoryapp.app

import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.screens.PriceAlarmsRoute
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.login.ui.LoginForm
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.model.domain.BrickLinkView
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * No text breaks character by character or within a word, none protrudes beyond its space,
 * no button and no heading is truncated: price alerts, collection, set detail,
 * catalog detail and sign-in on the phone (411 dp) at 100 and 200 % font, plus
 * background work (100 %, 360 dp) and the set detail with five-digit amounts (360 dp).
 *
 * Measured on the text layout of every text node: narrower than about three characters, more lines
 * than words, a line end between two letters, a line wider than the text.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   preisalarm-zeile-gequetscht      badge and „zuletzt …“ again in one Row, the badge
 *                                    again with the long text → red “price alerts at 100 percent”
 *                                    („zuletzt CHF 449.95“ in 17 lines for 3 words)
 *   katalog-knoepfe-nebeneinander    add and remember again side by side, each one line with
 *                                    ellipsis → red “catalog detail at 100 percent”
 *                                    („Zur Sammlung hinzufügen“ truncated)
 *   standard-zustand-in-der-zeile    „Standard-Zustand“ again next to the choice → red
 *                                    “background work at 100 percent” (on 360 dp „Gebraucht“
 *                                    broken within the word)
 *   gewinn-in-einer-zeile            profit/loss again always single-line → red “narrow set detail
 *                                    at 200 percent” („+CHF 20’200.90 · +19.2%“ protrudes beyond the tile,
 *                                    measured at the natural width)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WrapGuardTest {

    @get:Rule
    val compose = createComposeRule()

    private val world = Examples.World(ContextTexts())
    private val images = SampleImages.loader(ApplicationProvider.getApplicationContext())
    private val before = Locale.getDefault()

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    /** Like ScreenPhotoTest: drive the main looper until the data is there and the world rests. */
    private fun drive(name: String, ready: () -> Boolean) =
        driveUntil(name, requests = { world.paths.requests.size }, ready = ready)

    private fun check(name: String, font: Float, ready: () -> Boolean = { true },
                       device: String = "w411dp-h891dp-port-xxhdpi", wholeRow: Boolean = false,
                       content: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("de-rCH-$device")
        if (font != 1f) RuntimeEnvironment.setFontScale(font)
        Locale.setDefault(Locale.forLanguageTag("de-CH"))
        drive(name, ready)
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, font)) {
                    Surface(color = MaterialTheme.colorScheme.background) { content() }
                }
            }
        }
        drive("$name (angezeigt)", ready)
        compose.waitForIdle()
        // Stop the clock and advance: fade-ins have then run to completion.
        compose.mainClock.autoAdvance = false
        repeat(20) {
            compose.mainClock.advanceTimeBy(100)
            shadowOf(Looper.getMainLooper()).idle()
        }
        val (texts, findings) = collect(compose.onRoot(useUnmergedTree = true).fetchSemanticsNode(), wholeRow)
        // Empty screens check nothing.
        assertTrue("$name: nur $texts Textknoten — sind die Daten da?", texts >= 5)
        assertTrue("$name: ${findings.joinToString("; ")}", findings.isEmpty())
    }

    /** The text layout of a node, except for input fields (whose content scrolls). */
    private fun layout(n: SemanticsNode): TextLayoutResult? {
        if (n.config.getOrNull(SemanticsActions.SetText) != null) return null
        val list = mutableListOf<TextLayoutResult>()
        n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(list)
        return list.firstOrNull()
    }

    private fun textNode(n: SemanticsNode): Int = (if (layout(n) != null) 1 else 0) + n.children.sumOf { textNode(it) }

    /**
     * Counts the text nodes and collects findings. A „button“ is a node with the role
     * button and at most two texts below it: a clickable tile carries
     * the role too, but may truncate its name after two lines.
     */
    private fun collect(root: SemanticsNode, wholeRow: Boolean): Pair<Int, List<String>> {
        val findings = mutableListOf<String>()
        var texts = 0
        fun jobRun(n: SemanticsNode, inButton: Boolean, inHeading: Boolean) {
            val button = inButton || (n.config.getOrNull(SemanticsProperties.Role) == Role.Button && textNode(n) in 1..2)
            val header = inHeading || n.config.getOrNull(SemanticsProperties.Heading) != null
            val l = layout(n)
            if (l != null && n.layoutInfo.isPlaced) {
                texts++
                findings += anomalies(l, button, header, wholeRow)
            }
            n.children.forEach { jobRun(it, button, header) }
        }
        jobRun(root, inButton = false, inHeading = false)
        return texts to findings
    }

    /** What stands out about a set text: too narrow, a letter per line, truncated in a button or heading. */
    private fun anomalies(l: TextLayoutResult, button: Boolean, header: Boolean, wholeRow: Boolean): List<String> {
        val findings = mutableListOf<String>()
        val text = l.layoutInput.text.text
        val where = "„${text.take(40)}“"
        val size = l.layoutInput.style.fontSize
        val em = if (size.isSp) with(l.layoutInput.density) { size.toPx() } else 0f
        val words = text.split(Regex("""\s+""")).count { it.isNotBlank() }
        val chars = text.count { !it.isWhitespace() }
        if (chars >= 3 && em > 0f && l.size.width < em * MIN_WIDTH_EM)
            findings += "$where nur ${l.size.width} px breit (Schrift ${em.toInt()} px)"
        if (l.lineCount >= 3 && l.lineCount > 2 * words)
            findings += "$where in ${l.lineCount} Zeilen bei $words Wörtern"
        findings += inWordOrViaTheEdge(l, where, em, wholeRow)
        // Only the ellipsis counts: width, height and maxLines also report an overflow under
        // Robolectric for untruncated texts (font metrics).
        val truncated = (0 until l.lineCount).any { l.isLineEllipsized(it) }
        if ((button || header) && truncated) findings += "$where gekürzt (${if (button) "Knopf" else "Überschrift"}; " +
            "Zeilen ${l.lineCount}, Breite ${l.size.width}/${l.multiParagraph.width.toInt()}, " +
            "Überlauf B ${l.didOverflowWidth} H ${l.didOverflowHeight}, maxLines ${l.multiParagraph.didExceedMaxLines})"
        return findings
    }

    /**
     * „Gebrauch|t“: a line end between two letters or digits breaks the word
     * itself. And a line wider than its space: the rest is cut off. Measured
     * is the width of the line, not its right end: the semantics' text layout lies
     * on the whole space limit, a centered line ends there to the right of the display.
     *
     * [wholeRow]: the semantics re-sets a text without wrapping (softWrap = false) into
     * the space width and wraps it there; cut off it can only be seen at its
     * natural width. Only where required: the other screens are not measured that way.
     */
    private fun inWordOrViaTheEdge(l: TextLayoutResult, where: String, em: Float, wholeRow: Boolean): List<String> {
        val text = l.layoutInput.text.text
        val findings = mutableListOf<String>()
        val inWord = (0 until l.lineCount - 1).map { l.getLineEnd(it) }
            .firstOrNull { e -> e in 1 until text.length && text[e - 1].isLetterOrDigit() && text[e].isLetterOrDigit() }
        if (inWord != null) findings += "$where im Wort gebrochen nach „${text.take(inWord).takeLast(12)}“"
        val rows = (0 until l.lineCount).maxOf { l.getLineRight(it) - l.getLineLeft(it) }
        val natural = if (wholeRow && !l.layoutInput.softWrap && l.layoutInput.overflow != TextOverflow.Ellipsis)
            l.multiParagraph.intrinsics.maxIntrinsicWidth else 0f
        val overhang = maxOf(rows, natural) - l.size.width
        if (em > 0f && overhang > em * OVERHANG_EM) findings += "$where ragt ${overhang.toInt()} px über den Rand"
        return findings
    }

    // ── Die Bildschirme ──

    private fun entryVm() = world.t.track(EntryViewModel(world.t.session, world.t.filter(), world.t.hints, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.wantedList(),
        testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    private fun settings() = world.t.track(SettingsViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api),
        world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader {
            override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
        }))

    /** One alert armed, one triggered with last price — the row that wrapped character by character. */
    private fun priceAlarms(font: Float) {
        world.paths.responses["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF"},
            {"set_number":"10294-1","condition":"N","direction":"ueber","threshold":440.0,"currency_code":"CHF",
             "triggered":true,"last_triggered_at":"2026-10-30T09:00:00Z","last_price":449.95}]}"""
        val vm = settings().also { it.loadAlarmOverview() }
        check("Preisalarme $font", font, { vm.alarmOverview.value.loaded }) {
            PriceAlarmsRoute(vm = vm, imageLoader = images, serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onBack = {}, reportToggle = {})
        }
    }

    private fun gallery(font: Float) {
        val vm = world.gallery().also { it.loadSets(); it.loadStats() }
        check("Sammlung $font", font,
            { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.fetch.loading } }) {
            GalleryRoute(vm = vm, entryVm = entryVm(), imageLoader = images, onScanBarcode = {}, onSetClick = {})
        }
    }

    private fun setDetail(font: Float) {
        val vm = world.setDetail()
        check("Set-Detail $font", font, { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.detailFetch.loading && !s.priceFetch.loading && !s.historyFetch.loading && !s.purchasesFetch.loading } }) {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = images, onBack = {}, onDelete = {})
        }
    }

    private fun catalogDetail(font: Float) {
        val detail = CatalogDetailView(
            setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
            numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
            bricklink = BrickLinkView(number = "10305-1",
                url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))
        check("Katalog-Detail $font", font) {
            CatalogDetailScreen(setNumber = "10305-1", loaded = Load.Data(detail), imageLoader = images,
                serverUrl = "", onLoad = {}, onAddToGallery = {}, onWish = {},
                onOpenInGallery = {}, onBack = {})
        }
    }

    /**
     * Five-digit amounts on 360 dp: „+CHF 20’200.90 · +19.2%“ is wider than the tile at 200 %
     * (a three-digit profit just about fits). The amount stands without wrapping,
     * which is why [check] measures the natural width here.
     */
    private fun setDetailNarrow(font: Float) {
        world.paths.responses["/api/v1/sets/75192-1"] = """{"success":true,"quantity":1,"set":{"set_number":"75192-1",
            "image_local":"/beispiel/set1.png","name":"Millennium Falcon","year":2017,"theme":"Star Wars","quantity":1,
            "num_parts":7541,"minifigs":7,"added_at":"2026-03-14T10:00:00Z","avg_purchase_price":1049.0}}"""
        world.paths.responses["/api/v1/sets/75192-1/price"] =
            """{"success":true,"set_number":"75192-1","currency":"CHF","avg_price":21249.9,"min_price":20180.0,"max_price":21320.0,"qty_avg_price":21249.9}"""
        world.paths.responses["/api/v1/sets/75192-1/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"purchase_price":1049.0,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"}]}"""
        world.paths.responses["/api/v1/sets/75192-1/price-history"] = """{"success":true,"set_number":"75192-1","currency":"CHF",
            "by_condition":{"N":{"market_price":1249.9,"purchase_price":1049.0,"pnl_pct":"19.2","pnl_prozent":19.2}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":1210.0},{"x":"2026-10-01","y":1249.9}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-10-01"]},
            "pnl_prozent":19.2,"purchase_price":1049.0}"""
        val vm = world.setDetail()
        check("Set-Detail schmal $font", font, { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.detailFetch.loading && !s.priceFetch.loading && !s.historyFetch.loading && !s.purchasesFetch.loading } },
            device = "w360dp-h740dp-port-xxhdpi", wholeRow = true) {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = images, onBack = {}, onDelete = {})
        }
        inImage("Set-Detail schmal $font", "200.90")
    }

    /**
     * Like the photo of the background work: one running job, below it the price cache.
     * On 360 dp: the segment measures its label without the check mark, which is why on 411 dp
     * „Gebraucht“ also fits next to „Standard-Zustand“.
     */
    private fun backgroundWork(font: Float) {
        world.paths.responses["/api/v1/admin/auftraege"] = """{"success":true,
            "auftraege":[
              {"id":"17","type":"bilder","status":"laeuft","attempts":1,"max_attempts":5,"due_at":"2026-10-30T10:00:00Z",
               "deadline_at":null,"started_at":"2026-10-30T10:00:05Z","created_at":"2026-10-30T09:59:00Z","updated_at":null,
               "progress":{"erledigt":3,"gesamt":12,"text":"Bilder"},"error_message":null,"user_id":4,"geplant":false,"set_number":"75192-1"}],
            "zusammenfassung":[],"pausen":[],"bildbedarf":7,
            "job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":true}}"""
        val vm = MonitoringViewModel(testManagementRepository(world.t.api), testAccountRepository(world.t.api, world.t.io), world.t.messages)
        runBlocking { vm.loadBackground() }
        val events = CacheEvents({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> })
        val background = vm.background.value
        check("Hintergrundarbeiten $font", font, device = "w360dp-h891dp-port-xxhdpi") {
            MonitoringScreen(MonitoringState(MonitoringUiState(defaultState = Condition.USED), background, ManagementUiState(),
                emptyMap(), Design.CLASSIC, 0L), vm, events)
        }
        inImage("Hintergrundarbeiten $font", "Gebraucht")
    }

    /** The place a counter-check breaks must have been checked: a missing node reports nothing. */
    private fun inImage(name: String, text: String) = assertTrue("$name: kein Text mit „$text“ — die Stelle lag nicht im Bild",
        compose.onAllNodes(hasText(text, substring = true), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())

    private fun login(font: Float) {
        check("Anmeldung $font", font) {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNeeded = false,
                form = LoginForm.LOGIN, registrationOpen = true, accountRunning = false,
                accountMessage = null, accountError = null, onLogin = { _, _, _ -> }, onForm = {},
                onRegister = { _, _, _, _, _ -> }, onPasswordForget = {}, onChangeServer = {},
            )
        }
    }

    @Test fun `price alerts at 100 percent without character wrapping and truncation`() = priceAlarms(1f)
    @Test fun `price alerts at 200 percent without character wrapping and truncation`() = priceAlarms(2f)
    @Test fun `collection at 100 percent without character wrapping and truncation`() = gallery(1f)
    @Test fun `collection at 200 percent without character wrapping and truncation`() = gallery(2f)
    @Test fun `set detail at 100 percent without character wrapping and truncation`() = setDetail(1f)
    @Test fun `set detail at 200 percent without character wrapping and truncation`() = setDetail(2f)
    @Test fun `catalog detail at 100 percent without character wrapping and truncation`() = catalogDetail(1f)
    @Test fun `catalog detail at 200 percent without character wrapping and truncation`() = catalogDetail(2f)
    @Test fun `sign-in at 100 percent without character wrapping and truncation`() = login(1f)
    @Test fun `sign-in at 200 percent without character wrapping and truncation`() = login(2f)
    @Test fun `narrow set detail at 100 percent without character wrapping and truncation`() = setDetailNarrow(1f)
    @Test fun `narrow set detail at 200 percent without character wrapping and truncation`() = setDetailNarrow(2f)
    @Test fun `background work at 100 percent without character wrapping and truncation`() = backgroundWork(1f)

    private companion object {
        /** About three narrow characters: one character per line is narrower, „Neu“ wider. */
        const val MIN_WIDTH_EM = 1.2f
        /** More than half a character beyond the edge; below that lies the inaccuracy of the font metrics. */
        const val OVERHANG_EM = 0.5f
    }
}
