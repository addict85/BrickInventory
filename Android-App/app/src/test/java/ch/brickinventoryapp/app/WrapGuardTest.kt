package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
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
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.account.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
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
import ch.brickinventoryapp.model.domain.BrickLinkView
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import kotlinx.coroutines.runBlocking

/**
 * Kein Text bricht Zeichen für Zeichen oder im Wort um, keiner ragt über seinen Platz,
 * kein Knopf und keine Überschrift wird gekürzt: Preisalarme, Sammlung, Set-Detail,
 * Katalog-Detail und Anmeldung auf dem Telefon (411 dp) bei 100 und 200 % Schrift, dazu
 * die Hintergrundarbeiten (100 %, 360 dp) und das Set-Detail mit fünfstelligen Beträgen (360 dp).
 *
 * Gemessen am Textlayout jedes Textknotens: schmaler als etwa drei Zeichen, mehr Zeilen
 * als Wörter, ein Zeilenende zwischen zwei Buchstaben, eine Zeile breiter als der Text.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   preisalarm-zeile-gequetscht      Plakette und „zuletzt …“ wieder in einer Row, die Plakette
 *                                    wieder mit dem langen Text → rot „Preisalarme bei 100 Prozent“
 *                                    („zuletzt CHF 449.95“ in 17 Zeilen bei 3 Wörtern)
 *   katalog-knoepfe-nebeneinander    Aufnehmen und Merken wieder nebeneinander, je eine Zeile mit
 *                                    Auslassung → rot „Katalog-Detail bei 100 Prozent“
 *                                    („Zur Sammlung hinzufügen“ gekürzt)
 *   standard-zustand-in-der-zeile    „Standard-Zustand“ wieder neben der Wahl → rot
 *                                    „Hintergrundarbeiten bei 100 Prozent“ (auf 360 dp „Gebraucht“
 *                                    im Wort gebrochen)
 *   gewinn-in-einer-zeile            Gewinn/Verlust wieder stets einzeilig → rot „Set-Detail schmal
 *                                    bei 200 Prozent“ („+CHF 20’200.90 · +19.2%“ ragt über die Kachel,
 *                                    gemessen an der natürlichen Breite)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WrapGuardTest {

    @get:Rule
    val compose = createComposeRule()

    private val world = Examples.Welt(ContextTexts())
    private val bilder = SampleImages.loader(ApplicationProvider.getApplicationContext())
    private val vorher = Locale.getDefault()

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    /** Wie ScreenPhotoTest: den Hauptlooper treiben, bis die Daten da sind und die Welt ruht. */
    private fun drive(name: String, bereit: () -> Boolean) =
        driveUntil(name, requests = { world.paths.requests.size }, bereit = bereit)

    private fun pruefe(name: String, schrift: Float, bereit: () -> Boolean = { true },
                       geraet: String = "w411dp-h891dp-port-xxhdpi", wholeRow: Boolean = false,
                       inhalt: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("de-rCH-$geraet")
        if (schrift != 1f) RuntimeEnvironment.setFontScale(schrift)
        Locale.setDefault(Locale.forLanguageTag("de-CH"))
        drive(name, bereit)
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        drive("$name (angezeigt)", bereit)
        compose.waitForIdle()
        // Die Uhr anhalten und vorstellen: Einblendungen sind dann fertig gelaufen.
        compose.mainClock.autoAdvance = false
        repeat(20) {
            compose.mainClock.advanceTimeBy(100)
            shadowOf(Looper.getMainLooper()).idle()
        }
        val (texts, findings) = collect(compose.onRoot(useUnmergedTree = true).fetchSemanticsNode(), wholeRow)
        // Leere Bildschirme prüfen nichts.
        assertTrue("$name: nur $texts Textknoten — sind die Daten da?", texts >= 5)
        assertTrue("$name: ${findings.joinToString("; ")}", findings.isEmpty())
    }

    /** Das Textlayout eines Knotens, ausser bei Eingabefeldern (deren Inhalt rollt). */
    private fun layout(n: SemanticsNode): TextLayoutResult? {
        if (n.config.getOrNull(SemanticsActions.SetText) != null) return null
        val liste = mutableListOf<TextLayoutResult>()
        n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(liste)
        return liste.firstOrNull()
    }

    private fun textNode(n: SemanticsNode): Int = (if (layout(n) != null) 1 else 0) + n.children.sumOf { textNode(it) }

    /**
     * Zählt die Textknoten und sammelt Befunde. Ein „Knopf“ ist ein Knoten mit der Rolle
     * Schaltfläche und höchstens zwei Texten darunter: Eine anklickbare Kachel trägt
     * die Rolle auch, darf ihren Namen aber nach zwei Zeilen kürzen.
     */
    private fun collect(root: SemanticsNode, wholeRow: Boolean): Pair<Int, List<String>> {
        val findings = mutableListOf<String>()
        var texts = 0
        fun lauf(n: SemanticsNode, inButton: Boolean, inHeading: Boolean) {
            val button = inButton || (n.config.getOrNull(SemanticsProperties.Role) == Role.Button && textNode(n) in 1..2)
            val kopf = inHeading || n.config.getOrNull(SemanticsProperties.Heading) != null
            val l = layout(n)
            if (l != null && n.layoutInfo.isPlaced) {
                texts++
                findings += anomalies(l, button, kopf, wholeRow)
            }
            n.children.forEach { lauf(it, button, kopf) }
        }
        lauf(root, inButton = false, inHeading = false)
        return texts to findings
    }

    /** Was an einem gesetzten Text auffällt: zu schmal, Buchstabe je Zeile, gekürzt in Knopf oder Überschrift. */
    private fun anomalies(l: TextLayoutResult, button: Boolean, kopf: Boolean, wholeRow: Boolean): List<String> {
        val findings = mutableListOf<String>()
        val text = l.layoutInput.text.text
        val wo = "„${text.take(40)}“"
        val groesse = l.layoutInput.style.fontSize
        val em = if (groesse.isSp) with(l.layoutInput.density) { groesse.toPx() } else 0f
        val words = text.split(Regex("""\s+""")).count { it.isNotBlank() }
        val zeichen = text.count { !it.isWhitespace() }
        if (zeichen >= 3 && em > 0f && l.size.width < em * MIN_WIDTH_EM)
            findings += "$wo nur ${l.size.width} px breit (Schrift ${em.toInt()} px)"
        if (l.lineCount >= 3 && l.lineCount > 2 * words)
            findings += "$wo in ${l.lineCount} Zeilen bei $words Wörtern"
        findings += inWordOrViaTheEdge(l, wo, em, wholeRow)
        // Nur die Auslassung zählt: Breite, Höhe und maxLines melden unter
        // Robolectric auch bei ungekürzten Texten einen Überlauf (Schriftmetrik).
        val gekuerzt = (0 until l.lineCount).any { l.isLineEllipsized(it) }
        if ((button || kopf) && gekuerzt) findings += "$wo gekürzt (${if (button) "Knopf" else "Überschrift"}; " +
            "Zeilen ${l.lineCount}, Breite ${l.size.width}/${l.multiParagraph.width.toInt()}, " +
            "Überlauf B ${l.didOverflowWidth} H ${l.didOverflowHeight}, maxLines ${l.multiParagraph.didExceedMaxLines})"
        return findings
    }

    /**
     * „Gebrauch|t“: ein Zeilenende zwischen zwei Buchstaben oder Ziffern bricht das Wort
     * selbst. Und eine Zeile, breiter als ihr Platz: Der Rest ist abgeschnitten. Gemessen
     * wird die Breite der Zeile, nicht ihr rechtes Ende: Das Textlayout der Semantik liegt
     * auf der ganzen Platzgrenze, eine zentrierte Zeile endet dort rechts der Anzeige.
     *
     * [wholeRow]: Einen Text ohne Umbruch (softWrap = false) setzt die Semantik neu in
     * die Platzbreite und bricht ihn dort um; abgeschnitten sieht man ihn nur an seiner
     * natürlichen Breite. Nur wo verlangt: Die übrigen Bildschirme sind so nicht gemessen.
     */
    private fun inWordOrViaTheEdge(l: TextLayoutResult, wo: String, em: Float, wholeRow: Boolean): List<String> {
        val text = l.layoutInput.text.text
        val findings = mutableListOf<String>()
        val inWord = (0 until l.lineCount - 1).map { l.getLineEnd(it) }
            .firstOrNull { e -> e in 1 until text.length && text[e - 1].isLetterOrDigit() && text[e].isLetterOrDigit() }
        if (inWord != null) findings += "$wo im Wort gebrochen nach „${text.take(inWord).takeLast(12)}“"
        val zeilen = (0 until l.lineCount).maxOf { l.getLineRight(it) - l.getLineLeft(it) }
        val natural = if (wholeRow && !l.layoutInput.softWrap && l.layoutInput.overflow != TextOverflow.Ellipsis)
            l.multiParagraph.intrinsics.maxIntrinsicWidth else 0f
        val overhang = maxOf(zeilen, natural) - l.size.width
        if (em > 0f && overhang > em * OVERHANG_EM) findings += "$wo ragt ${overhang.toInt()} px über den Rand"
        return findings
    }

    // ── Die Bildschirme ──

    private fun erfassung() = world.t.merke(EntryViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.merkliste(),
        testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    private fun einstellungen() = world.t.merke(SettingsViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api),
        world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader {
            override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null
        }))

    /** Ein Alarm scharf, einer ausgelöst mit letztem Preis — die Zeile, die zeichenweise umbrach. */
    private fun preisalarme(schrift: Float) {
        world.paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF"},
            {"set_number":"10294-1","condition":"N","direction":"ueber","threshold":440.0,"currency_code":"CHF",
             "triggered":true,"last_triggered_at":"2026-10-30T09:00:00Z","last_price":449.95}]}"""
        val vm = einstellungen().also { it.loadAlarmOverview() }
        pruefe("Preisalarme $schrift", schrift, { vm.alarmOverview.value.geladen }) {
            PreisalarmeRoute(vm = vm, imageLoader = bilder, serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, reportToggle = {})
        }
    }

    private fun galerie(schrift: Float) {
        val vm = world.galerie().also { it.loadSets(); it.loadStats() }
        pruefe("Sammlung $schrift", schrift,
            { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.abruf.laedt } }) {
            GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
    }

    private fun setDetail(schrift: Float) {
        val vm = world.setDetail()
        pruefe("Set-Detail $schrift", schrift, { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.detailFetch.laedt && !s.priceFetch.laedt && !s.historyFetch.laedt && !s.purchasesFetch.laedt } }) {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
        }
    }

    private fun catalogDetail(schrift: Float) {
        val detail = CatalogDetailView(
            setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
            numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
            bricklink = BrickLinkView(number = "10305-1",
                url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))
        pruefe("Katalog-Detail $schrift", schrift) {
            CatalogDetailScreen(setNumber = "10305-1", geladen = Laden.Daten(detail), imageLoader = bilder,
                serverUrl = "", onLoad = {}, onAddToGallery = {}, onWish = {},
                onOpenInGallery = {}, onBack = {})
        }
    }

    /**
     * Fünfstellige Beträge auf 360 dp: „+CHF 20’200.90 · +19.2%“ ist bei 200 % breiter als
     * die Kachel (ein dreistelliger Gewinn passt gerade noch). Der Betrag steht ohne Umbruch,
     * deshalb misst [pruefe] hier die natürliche Breite.
     */
    private fun setDetailNarrow(schrift: Float) {
        world.paths.antworten["/api/v1/sets/75192-1"] = """{"success":true,"quantity":1,"set":{"set_number":"75192-1",
            "image_local":"/beispiel/set1.png","name":"Millennium Falcon","year":2017,"theme":"Star Wars","quantity":1,
            "num_parts":7541,"minifigs":7,"added_at":"2026-03-14T10:00:00Z","avg_purchase_price":1049.0}}"""
        world.paths.antworten["/api/v1/sets/75192-1/price"] =
            """{"success":true,"set_number":"75192-1","currency":"CHF","avg_price":21249.9,"min_price":20180.0,"max_price":21320.0,"qty_avg_price":21249.9}"""
        world.paths.antworten["/api/v1/sets/75192-1/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"purchase_price":1049.0,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"}]}"""
        world.paths.antworten["/api/v1/sets/75192-1/price-history"] = """{"success":true,"set_number":"75192-1","currency":"CHF",
            "by_condition":{"N":{"market_price":1249.9,"purchase_price":1049.0,"pnl_pct":"19.2","pnl_prozent":19.2}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":1210.0},{"x":"2026-10-01","y":1249.9}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-10-01"]},
            "pnl_prozent":19.2,"purchase_price":1049.0}"""
        val vm = world.setDetail()
        pruefe("Set-Detail schmal $schrift", schrift, { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.detailFetch.laedt && !s.priceFetch.laedt && !s.historyFetch.laedt && !s.purchasesFetch.laedt } },
            geraet = "w360dp-h740dp-port-xxhdpi", wholeRow = true) {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
        }
        inImage("Set-Detail schmal $schrift", "200.90")
    }

    /**
     * Wie das Foto der Hintergrundarbeiten: ein laufender Auftrag, darunter der Preisspeicher.
     * Auf 360 dp: Das Segment misst seine Beschriftung ohne das Häkchen, auf 411 dp passt
     * „Gebraucht“ deshalb auch neben „Standard-Zustand“.
     */
    private fun hintergrundarbeiten(schrift: Float) {
        world.paths.antworten["/api/v1/admin/auftraege"] = """{"success":true,
            "auftraege":[
              {"id":"17","type":"bilder","status":"laeuft","attempts":1,"max_attempts":5,"due_at":"2026-10-30T10:00:00Z",
               "deadline_at":null,"started_at":"2026-10-30T10:00:05Z","created_at":"2026-10-30T09:59:00Z","updated_at":null,
               "progress":{"erledigt":3,"gesamt":12,"text":"Bilder"},"error_message":null,"user_id":4,"geplant":false,"set_number":"75192-1"}],
            "zusammenfassung":[],"pausen":[],"bildbedarf":7,
            "job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":true}}"""
        val vm = MonitoringViewModel(testManagementRepository(world.t.api), testAccountRepository(world.t.api, world.t.io), world.t.meldungen)
        runBlocking { vm.loadBackground() }
        val events = CacheEvents({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> })
        pruefe("Hintergrundarbeiten $schrift", schrift, geraet = "w360dp-h891dp-port-xxhdpi") {
            MonitoringScreen(MonitoringState(MonitoringUiState(defaultState = Zustand.GEBRAUCHT), vm.hintergrund.value, ManagementUiState(),
                emptyMap(), Design.CLASSIC, 0L), vm, events)
        }
        inImage("Hintergrundarbeiten $schrift", "Gebraucht")
    }

    /** Die Stelle, die eine Gegenprobe kaputt macht, muss geprüft worden sein: Ein fehlender Knoten meldet nichts. */
    private fun inImage(name: String, text: String) = assertTrue("$name: kein Text mit „$text“ — die Stelle lag nicht im Bild",
        compose.onAllNodes(hasText(text, substring = true), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())

    private fun anmeldung(schrift: Float) {
        pruefe("Anmeldung $schrift", schrift) {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
    }

    @Test fun `price alerts at 100 percent without character wrapping and truncation`() = preisalarme(1f)
    @Test fun `price alerts at 200 percent without character wrapping and truncation`() = preisalarme(2f)
    @Test fun `collection at 100 percent without character wrapping and truncation`() = galerie(1f)
    @Test fun `collection at 200 percent without character wrapping and truncation`() = galerie(2f)
    @Test fun `set detail at 100 percent without character wrapping and truncation`() = setDetail(1f)
    @Test fun `set detail at 200 percent without character wrapping and truncation`() = setDetail(2f)
    @Test fun `catalog detail at 100 percent without character wrapping and truncation`() = catalogDetail(1f)
    @Test fun `catalog detail at 200 percent without character wrapping and truncation`() = catalogDetail(2f)
    @Test fun `sign-in at 100 percent without character wrapping and truncation`() = anmeldung(1f)
    @Test fun `sign-in at 200 percent without character wrapping and truncation`() = anmeldung(2f)
    @Test fun `narrow set detail at 100 percent without character wrapping and truncation`() = setDetailNarrow(1f)
    @Test fun `narrow set detail at 200 percent without character wrapping and truncation`() = setDetailNarrow(2f)
    @Test fun `background work at 100 percent without character wrapping and truncation`() = hintergrundarbeiten(1f)

    private companion object {
        /** Etwa drei schmale Zeichen: Ein Zeichen pro Zeile ist schmaler, „Neu“ breiter. */
        const val MIN_WIDTH_EM = 1.2f
        /** Mehr als ein halbes Zeichen über den Rand; darunter liegt die Ungenauigkeit der Schriftmetrik. */
        const val OVERHANG_EM = 0.5f
    }
}
