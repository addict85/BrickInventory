package ch.brickinventoryapp

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
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.CsvImportUiState
import ch.brickinventoryapp.ui.KontoUiState
import ch.brickinventoryapp.ui.Screen
import ch.brickinventoryapp.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.util.PASSWORT_MIN_ZEICHEN
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

/**
 * Befunde der zehnten UI-Prüfung (Android), als Verhalten ausgeführt: Der
 * Erfassen-Knopf steigt über die Snackbar, offline steht ein Banner statt zweier
 * widersprüchlicher Zeilen, Fehler in Formularen werden angesagt, Passwortfelder
 * kennen Autofill und Auge, Verwalterrechte stehen unter „Erweitert“, die Kennzahlen
 * bleiben bei 200 % in einer Zeile, das Katalog-Detail nutzt das Tablet, und die
 * Finanzen nennen den Marktwert vor dem Verlauf.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   fab-unter-snackbar          ErfassenFab ohne Abstand zur Snackbar → rot „Erfassen-Knopf steigt …“
 *   offline-zwei-zeilen         Ausgangsleiste auch neben dem Offline-Hinweis → rot „Offline-Hinweis nennt …“
 *   preisalarm-rohzahl          Schwelle wieder als „750.0“ → rot „Preisalarme zeigen die Schwelle …“
 *   fehler-ohne-ansage          ansagen() ohne Live-Region → rot „Fehler der Anmeldung …“
 *   passwortfeld-ohne-autofill  PasswortFeld ohne contentType → rot „Startpasswort-Maske fuellt …“
 *   startpasswort-volle-breite  Maske ohne Lesebreite → rot „Startpasswort-Maske steht auf dem Tablet …“
 *   verwalterrechte-offen       „Erweitert“ von Anfang an offen → rot „Verwalterrechte stehen eingeklappt …“
 *   kennzahlen-umbrechen        Kennzahlen auch bei 200 % als FlowRow → rot „Kennzahlen stehen …“
 *   katalog-einspaltig          Katalog-Detail auch auf dem Tablet einspaltig → rot „Katalog-Detail steht …“
 *   finanzen-verlauf-zuerst     Verlauf wieder vor der Kopfkachel → rot „Finanzen nennen den Marktwert …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class GeruestUndFormularTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = java.util.Locale.getDefault()
    private val ctx: android.content.Context = ApplicationProvider.getApplicationContext()

    init { java.util.Locale.setDefault(java.util.Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = java.util.Locale.setDefault(vorher)

    private fun zeige(schrift: Float = 1f, inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = "classic") {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
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

    /** Das Gerüst mit einem Reiter; [inhalt] ist die Seite der Sammlung. */
    @Composable
    private fun Geruest(meldung: SnackbarHostState, offen: Int = 0, inhalt: @Composable () -> Unit) {
        val nav = rememberNavController()
        val reiter = remember {
            listOf<Triple<Screen, @Composable () -> Unit, String>>(
                Triple(Screen.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"))
        }
        MainScaffold(
            title = "Sammlung", navController = nav, bottomNavItems = reiter,
            snackbarHostState = meldung,
            csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
            onCsvAbbrechen = {}, serverUrl = "", onTabAngetippt = {}, offeneAenderungen = offen,
        ) {
            NavHost(nav, startDestination = Screen.Gallery.route) { composable(Screen.Gallery.route) { inhalt() } }
        }
    }

    @Test
    fun `Erfassen-Knopf steigt ueber die Snackbar`() {
        val meldung = SnackbarHostState()
        val erfassen = ctx.getString(R.string.gallery_add_set)
        zeige {
            Geruest(meldung) {
                Box(Modifier.fillMaxSize()) {
                    ch.brickinventoryapp.ui.components.ErfassenFab(erfassen, {},
                        Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross))
                }
            }
            LaunchedEffect(Unit) {
                meldung.showSnackbar("Titanic entfernt", actionLabel = "Rückgängig", duration = SnackbarDuration.Indefinite)
            }
        }
        compose.waitForIdle()
        val knopf = compose.onNodeWithContentDescription(erfassen).fetchSemanticsNode().boundsInRoot
        val snackbar = compose.onNodeWithText("Titanic entfernt").fetchSemanticsNode().boundsInRoot
        assertTrue("Der Knopf steht über der Snackbar ($knopf / $snackbar)", knopf.bottom <= snackbar.top)
    }

    @Test
    fun `Offline-Hinweis nennt die wartenden Aenderungen in einem Banner`() {
        zeige {
            Geruest(remember { SnackbarHostState() }, offen = 3) {
                Column { ch.brickinventoryapp.ui.components.OfflineHinweis(1_793_000_000_000L) }
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
    fun `Preisalarme zeigen die Schwelle als Betrag und die Richtung im Feld`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            welt.pfade.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
                {"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF"}]}"""
            val vm = welt.t.merke(ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel(welt.t.dienste,
                ch.brickinventoryapp.data.repository.KontoRepository(welt.t.api, welt.t.cache),
                ch.brickinventoryapp.data.repository.VerwaltungRepository(welt.t.api, welt.t.cache),
                ch.brickinventoryapp.data.repository.SetsRepository(welt.t.api, welt.t.cache),
                ch.brickinventoryapp.data.repository.TeileRepository(welt.t.api, welt.t.cache),
                object : ch.brickinventoryapp.ui.viewmodel.DateiLeser {
                    override suspend fun lies(uri: android.net.Uri): Pair<String?, ByteArray>? = null
                }))
            zeige {
                ch.brickinventoryapp.ui.screens.PreisalarmeUnterseite(vm = vm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                    snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, meldeSchalter = {})
            }
            warte("Alarme") { vm.alarmUebersicht.value.geladen }
            // „750.00“ wie jeder Betrag (de-CH), nicht die Rohzahl „750.0“; die Richtung im Feld.
            compose.onNode(hasSetTextAction() and hasText("750.00")).fetchSemanticsNode()
            compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.detail_alert_chip_below))).fetchSemanticsNode()
            // Kein eigener Speichern-Knopf: gespeichert wird wie im Set-Detail beim Tippen.
            compose.onAllNodesWithContentDescription(ctx.getString(R.string.settings_save)).assertCountEquals(0)
        } finally {
            welt.close()
        }
    }

    @Test
    fun `Fehler der Anmeldung und der Pflicht-Masken werden angesagt`() {
        val fall = mutableIntStateOf(0)
        val fehler = listOf("Benutzername oder Passwort falsch", "Das aktuelle Passwort stimmt nicht", "Der Code stimmt nicht")
        zeige {
            when (fall.intValue) {
                0 -> ch.brickinventoryapp.ui.screens.LoginScreen(
                    serverUrl = "https://brick.example.org", isLoading = false, error = fehler[0], codeNoetig = false,
                    formular = AnmeldeFormular.ANMELDEN, registrierungOffen = false, kontoLaeuft = false,
                    kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> },
                    onFormular = {}, onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
                )
                1 -> ch.brickinventoryapp.ui.screens.StartpasswortMaske(KontoUiState(fehler = fehler[1]), { _, _, _ -> }, {})
                else -> ch.brickinventoryapp.ui.screens.ZweiterFaktorPflichtMaske(
                    ZweiterFaktorUiState(aktiv = false, fehler = fehler[2]), {}, {}, {}, {})
            }
        }
        val angesagt = SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion)
        fehler.forEachIndexed { i, text ->
            fall.intValue = i
            compose.waitForIdle()
            compose.onNode(hasText(text) and angesagt, useUnmergedTree = true).fetchSemanticsNode("„$text“ wird nicht angesagt")
        }
    }

    /** Die Autofill-Art eines Feldes: der Wert seiner Semantik, der eine ContentType ist. */
    private fun autofill(knoten: androidx.compose.ui.semantics.SemanticsNode): Any? =
        knoten.config.firstOrNull { it.value is ContentType }?.value

    @Test
    fun `Startpasswort-Maske fuellt Passwoerter automatisch und zeigt sie auf Wunsch`() {
        zeige { ch.brickinventoryapp.ui.screens.StartpasswortMaske(KontoUiState(), { _, _, _ -> }, {}) }
        val felder = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes()
        assertEquals("Aktuelles, neues und wiederholtes Passwort",
            listOf(ContentType.Password, ContentType.NewPassword, ContentType.NewPassword), felder.map(::autofill))
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.cd_password_show)).assertCountEquals(3)
        // Die Mindestlänge steht da, bevor getippt wird.
        compose.onNodeWithText(ctx.resources.getQuantityString(R.plurals.passwort_mindestens, PASSWORT_MIN_ZEICHEN, PASSWORT_MIN_ZEICHEN)).fetchSemanticsNode()
    }

    @Test
    fun `Startpasswort-Maske steht auf dem Tablet in Lesebreite`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige { ch.brickinventoryapp.ui.screens.StartpasswortMaske(KontoUiState(), { _, _, _ -> }, {}) }
        val dichte = ctx.resources.displayMetrics.density
        val feld = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
        assertTrue("Feld ${feld.width / dichte} dp breit", feld.width / dichte <= 561f)
    }

    @Test
    fun `Verwalterrechte stehen eingeklappt unter Erweitert`() {
        zeige {
            ch.brickinventoryapp.ui.screens.LoginScreen(
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

    @Test
    fun `Kennzahlen stehen bei 200 Prozent in einer Zeile`() {
        val zahlen = listOf("12" to R.string.gallery_stat_sets, "15" to R.string.gallery_stat_units,
            "9'090" to R.string.gallery_stat_parts, "22" to R.string.gallery_stat_minifigs,
            "4" to R.string.gallery_stat_instructions).map { (wert, text) -> wert to ctx.getString(text) }
        zeige(schrift = 2f) {
            Box(Modifier.width(360.dp)) {
                ch.brickinventoryapp.ui.screens.KennzahlenReihe {
                    zahlen.forEach { (wert, text) -> ch.brickinventoryapp.ui.screens.GalleryStatChip(wert, text) }
                }
            }
        }
        val oben = zahlen.map { (wert, text) ->
            // positionInRoot statt boundsInRoot: Was rechts aus der wischbaren Zeile ragt,
            // wäre abgeschnitten und stünde scheinbar bei 0.
            compose.onNodeWithText("$wert $text", useUnmergedTree = true).fetchSemanticsNode().positionInRoot.y
        }
        assertTrue("Kennzahlen in einer Zeile: $oben", oben.all { kotlin.math.abs(it - oben[0]) < 1f })
    }

    private val katalogDetail = ch.brickinventoryapp.ui.model.KatalogDetailAnsicht(
        setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
        numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
        bricklink = ch.brickinventoryapp.ui.model.BrickLinkAnsicht(number = "10305-1",
            url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))

    @Test
    fun `Katalog-Detail steht auf dem Tablet in zwei Spalten, Aufnehmen vor BrickLink`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige {
            ch.brickinventoryapp.ui.screens.CatalogDetailScreen(setNumber = "10305-1", detail = katalogDetail,
                isLoading = false, imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "", onLoad = {},
                onAddToGallery = { _, _, _, _, _, _ -> }, onWish = { _, _, _, _, _ -> },
                onOpenInGallery = {}, onBack = {})
        }
        // Der Name steht einmal da: in der Überschrift, nicht zugleich in der App-Leiste.
        compose.onAllNodesWithText("Lion Knights' Castle").assertCountEquals(1)
        val name = compose.onNodeWithText("Lion Knights' Castle").fetchSemanticsNode().boundsInRoot
        val bild = compose.onNode(hasTestTag(ch.brickinventoryapp.ui.components.BILD_ERSATZ), useUnmergedTree = true)
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Die Angaben stehen rechts vom Bild ($bild / $name)", name.left >= bild.right)
        val aufnehmen = compose.onNode(hasText(ctx.getString(R.string.catalog_add_to_gallery)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        val bricklink = compose.onNode(hasText(ctx.getString(R.string.catalog_buy_bricklink)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Die eigene Handlung steht vor dem Weg nach draussen", aufnehmen.bottom <= bricklink.top)
    }

    @Test
    fun `Finanzen nennen den Marktwert vor dem Verlauf`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            zeige { ch.brickinventoryapp.ui.screens.FinanceScreen(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
            warte("Finanzen") { vm.financeState.value.let { it.valuation != null && !it.valuationLoading && !it.historyLoading } }
            val kopf = compose.onNodeWithText(ctx.getString(R.string.finance_market_avg), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot
            val verlauf = compose.onNodeWithText(ctx.getString(R.string.chart_portfolio_value), useUnmergedTree = true)
                .fetchSemanticsNode().boundsInRoot
            assertTrue("Kopfkachel ($kopf) vor dem Verlauf ($verlauf)", kopf.bottom <= verlauf.top)
        } finally {
            welt.close()
        }
    }
}
