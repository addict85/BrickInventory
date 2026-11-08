package ch.brickinventoryapp.app

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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.AnmeldeFormular
import ch.brickinventoryapp.zustand.ui.CsvImportUiState
import ch.brickinventoryapp.konto.ui.KontoUiState
import ch.brickinventoryapp.zustand.ui.Screen
import ch.brickinventoryapp.konto.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.data.util.PASSWORT_MIN_ZEICHEN
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
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.ui.components.BILD_ERSATZ
import ch.brickinventoryapp.ui.components.ErfassenFab
import ch.brickinventoryapp.ui.components.MarkenKopf
import ch.brickinventoryapp.ui.components.OfflineHinweis
import ch.brickinventoryapp.ui.components.bewegungReduziert
import ch.brickinventoryapp.model.ui.model.BrickLinkAnsicht
import ch.brickinventoryapp.model.ui.model.KatalogDetailAnsicht
import ch.brickinventoryapp.katalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.finanzen.ui.screens.FinanceRoute
import ch.brickinventoryapp.ui.screens.GalleryStatChip
import ch.brickinventoryapp.ui.screens.KennzahlenReihe
import ch.brickinventoryapp.anmeldung.ui.screens.LoginScreen
import ch.brickinventoryapp.konto.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.anmeldung.ui.screens.SetupScreen
import ch.brickinventoryapp.konto.ui.screens.StartpasswortMaske
import ch.brickinventoryapp.ui.screens.StatChipV2
import ch.brickinventoryapp.konto.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.util.fmtInt
import android.content.Context
import android.os.Looper
import android.provider.Settings
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsNode
import java.util.Locale
import org.robolectric.Shadows
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TeileRepository

/**
 * Befunde der zehnten und elften UI-Prüfung (Android), als Verhalten ausgeführt: Der
 * Erfassen-Knopf steigt über die Snackbar, offline steht ein neutrales Banner statt zweier
 * widersprüchlicher Zeilen, Fehler in Formularen werden angesagt, Passwortfelder
 * kennen Autofill und Auge, Verwalterrechte stehen unter „Erweitert“, der Server-Chip
 * sagt, was er tut, die Kennzahlen brechen in Sammlung und Detail um, das Katalog-Detail nutzt das Tablet, und die Finanzen nennen den Marktwert
 * vor dem Verlauf.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   fab-unter-snackbar          ErfassenFab ohne Abstand zur Snackbar → rot „Erfassen-Knopf steigt …“
 *   offline-zwei-zeilen         Ausgangsleiste auch neben dem Offline-Hinweis → rot „Offline-Hinweis nennt …“
 *   preisalarm-rohzahl          Schwelle wieder als „750.0“ → rot „Preisalarme zeigen die Schwelle …“
 *   fehler-ohne-ansage          ansagen() ohne Live-Region → rot „Fehler der Anmeldung …“
 *   passwortfeld-ohne-autofill  PasswortFeld ohne contentType → rot „Startpasswort-Maske fuellt …“
 *   startpasswort-volle-breite  Maske ohne Lesebreite → rot „Startpasswort-Maske steht auf dem Tablet …“
 *   verwalterrechte-offen       „Erweitert“ von Anfang an offen → rot „Verwalterrechte stehen eingeklappt …“
 *   kennzahlen-ohne-umbruch     Kennzahlen in einer Row statt FlowRow → rot „Kennzahlen der Sammlung …“
 *   offline-in-fehlerrot        Banner wieder in tertiaryContainer (Classic: rot) → rot „Offline-Hinweis meldet …“
 *   server-chip-ohne-aufgabe    Chip ohne Beschreibung → rot „Server-Chip nennt …“
 *   katalog-einspaltig          Katalog-Detail auch auf dem Tablet einspaltig → rot „Katalog-Detail steht …“
 *   finanzen-verlauf-zuerst     Verlauf wieder vor der Kopfkachel → rot „Finanzen nennen den Marktwert …“
 *   katalog-bild-ohne-grenze    Katalogbild wieder ohne Höchstbreite → rot „Katalog-Detail steht …“
 *   alarme-volle-breite         Preisalarme wieder in Listenbreite → rot „Konto und Preisalarme …“
 *   markenkopf-immer-gross      Markenkopf auch bei 200 % gross → rot „Markenkopf bei 200 Prozent …“
 *   bewegung-immer-an           bewegungReduziert() liefert immer false → rot „reduzierte Bewegung …“
 *   einrichtung-einspaltig      Einrichtung auch quer einspaltig → rot „Einrichtung im Querformat …“
 *   detailzeile-volle-breite    Detailzeile ohne Lesebreite → rot „Detailkarten stehen auf dem Tablet …“
 *   bewegung-ohne-beobachter    Einstellung nur einmal gelesen → rot „reduzierte Bewegung folgt einer Aenderung …“
 *   startpasswort-ohne-grund    gesperrter Knopf ohne Grund → rot „Startpasswort-Maske sagt …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class GeruestUndFormularTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

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

    /** Die Welt antwortet im Takt; den Hauptlooper treiben, bis [fertig] gilt. */
    private fun warte(name: String, fertig: () -> Boolean) {
        treibeBis(name, bereit = fertig)
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
            onCsvAbbrechen = {}, onTabAngetippt = {}, offeneAenderungen = offen,
        ) {
            NavHost(nav, startDestination = Screen.Gallery) { composable<Screen.Gallery> { inhalt() } }
        }
    }

    @Test
    fun `Erfassen-Knopf steigt ueber die Snackbar`() {
        val meldung = SnackbarHostState()
        val erfassen = ctx.getString(R.string.gallery_add_set)
        zeige {
            Geruest(meldung) {
                Box(Modifier.fillMaxSize()) {
                    ErfassenFab(erfassen, {},
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
                Column { OfflineHinweis(1_793_000_000_000L) }
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
            val vm = welt.t.merke(EinstellungenViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.bestand,
                KontoRepository(welt.t.api, welt.t.cache, welt.t.io),
                VerwaltungRepository(welt.t.api, welt.t.cache),
                SetsRepository(welt.t.api, welt.t.cache),
                TeileRepository(welt.t.api, welt.t.cache),
                object : DateiLeser {
                    override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null
                }))
            zeige {
                PreisalarmeRoute(vm = vm,
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
                0 -> LoginScreen(
                    serverUrl = "https://brick.example.org", isLoading = false, error = fehler[0], codeNoetig = false,
                    formular = AnmeldeFormular.ANMELDEN, registrierungOffen = false, kontoLaeuft = false,
                    kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> },
                    onFormular = {}, onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
                )
                1 -> StartpasswortMaske(KontoUiState(fehler = fehler[1]), { _, _, _ -> }, {})
                else -> ZweiterFaktorPflichtMaske(
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
    private fun autofill(knoten: SemanticsNode): Any? =
        knoten.config.firstOrNull { it.value is ContentType }?.value

    @Test
    fun `Startpasswort-Maske fuellt Passwoerter automatisch und zeigt sie auf Wunsch`() {
        zeige { StartpasswortMaske(KontoUiState(), { _, _, _ -> }, {}) }
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
        zeige { StartpasswortMaske(KontoUiState(), { _, _, _ -> }, {}) }
        val dichte = ctx.resources.displayMetrics.density
        val feld = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
        assertTrue("Feld ${feld.width / dichte} dp breit", feld.width / dichte <= 561f)
    }

    /** Konto und Preisalarme sind Formulare: Lesebreite, und das Betragsfeld bleibt schmal. */
    @Test
    fun `Konto und Preisalarme stehen auf dem Tablet in Formularbreite`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        val welt = Beispiele.Welt(KontextTexte())
        try {
            welt.pfade.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
                {"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF","name":"Millennium Falcon"}]}"""
            val vm = welt.t.merke(EinstellungenViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.bestand,
                KontoRepository(welt.t.api, welt.t.cache, welt.t.io),
                VerwaltungRepository(welt.t.api, welt.t.cache),
                SetsRepository(welt.t.api, welt.t.cache),
                TeileRepository(welt.t.api, welt.t.cache),
                object : DateiLeser {
                    override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null
                }))
            zeige {
                PreisalarmeRoute(vm = vm,
                    imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                    snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, meldeSchalter = {})
            }
            warte("Alarme") { vm.alarmUebersicht.value.geladen }
            val dichte = ctx.resources.displayMetrics.density
            val feld = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().boundsInRoot
            // Mittig auf 560 dp beginnt die Karte bei 360 dp; in Listenbreite (840 dp) schon bei 220.
            assertTrue("Die Karte steht in Formularbreite (Feld ab ${feld.left / dichte} dp)", feld.left / dichte >= 340f)
            assertTrue("Das Betragsfeld ist ${feld.width / dichte} dp breit", feld.width / dichte <= 321f)
        } finally {
            welt.close()
        }
    }

    /** Im Querformat stehen Hinweis und Handlung nebeneinander: „Weiter“ ohne Rollen sichtbar. */
    @Test
    fun `Einrichtung im Querformat zeigt Weiter ohne Rollen`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige { SetupScreen(currentUrl = "http://nas:3000", onSave = {}, entwicklung = false) }
        val hoehe = compose.onRoot().fetchSemanticsNode().boundsInRoot.height
        // Ungekürzt gemessen: boundsInRoot schnitte einen Knopf unter dem Falz am Rand ab.
        val weiter = compose.onNode(hasText(ctx.getString(R.string.setup_continue)) and hasClickAction()).fetchSemanticsNode()
        val unten = weiter.positionInRoot.y + weiter.size.height
        assertTrue("Weiter endet bei $unten von $hoehe", unten <= hoehe)
    }

    /** Bei 200 % steht der Markenkopf klein in einer Zeile; das erste Feld bleibt oben. */
    @Test
    fun `Markenkopf bei 200 Prozent nimmt hoechstens ein Achtel der Hoehe`() {
        zeige(schrift = 2f) { MarkenKopf() }
        val dichte = ctx.resources.displayMetrics.density
        val kopf = compose.onNodeWithText(ctx.getString(R.string.app_name)).fetchSemanticsNode().boundsInRoot
        assertTrue("Markenkopf endet erst bei ${kopf.bottom / dichte} dp", kopf.bottom / dichte <= 891f / 8)
    }

    /** „Animationen entfernen“ (Animator-Dauer 0) wird gelesen; sonst gilt Bewegung. */
    @Test
    fun `reduzierte Bewegung folgt der Animator-Dauer des Systems`() {
        val aufloesung = ctx.contentResolver
        Settings.Global.putFloat(aufloesung, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        var ruhig: Boolean? = null
        zeige { ruhig = bewegungReduziert() }
        assertEquals("Mit Animator-Dauer 0 ruht alles", true, ruhig)
        Settings.Global.putFloat(aufloesung, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    }

    /** Umgestellt wird bei offener App in den Systemeinstellungen; die Bewegung folgt sofort. */
    @Test
    fun `reduzierte Bewegung folgt einer Aenderung zur Laufzeit`() {
        val aufloesung = ctx.contentResolver
        val dauer = Settings.Global.ANIMATOR_DURATION_SCALE
        Settings.Global.putFloat(aufloesung, dauer, 1f)
        var ruhig: Boolean? = null
        zeige { ruhig = bewegungReduziert() }
        assertEquals("Mit Animator-Dauer 1 bewegt sich alles", false, ruhig)
        try {
            Settings.Global.putFloat(aufloesung, dauer, 0f)
            aufloesung.notifyChange(Settings.Global.getUriFor(dauer), null)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            compose.waitForIdle()
            assertEquals("Nach dem Umstellen ruht alles", true, ruhig)
        } finally {
            Settings.Global.putFloat(aufloesung, dauer, 1f)
        }
    }

    /** Ein gesperrter Hauptknopf sagt, was fehlt, bis alles da ist. */
    @Test
    fun `Startpasswort-Maske sagt, was zum Aendern fehlt`() {
        zeige { StartpasswortMaske(KontoUiState(), { _, _, _ -> }, {}) }
        val grund = ctx.getString(R.string.passwort_aendern_fehlt)
        compose.onNodeWithText(grund).fetchSemanticsNode()
        val felder = compose.onAllNodes(hasSetTextAction())
        felder[0].performTextInput("altes-passwort-1")
        felder[1].performTextInput("neues-passwort-12")
        felder[2].performTextInput("neues-passwort-12")
        compose.waitForIdle()
        compose.onAllNodesWithText(grund).assertCountEquals(0)
    }

    @Test
    fun `Verwalterrechte stehen eingeklappt unter Erweitert`() {
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

    private val kennzahlen = listOf(12 to R.plurals.gallery_stat_sets, 15 to R.plurals.gallery_stat_units,
        9090 to R.plurals.gallery_stat_parts, 22 to R.plurals.gallery_stat_minifigs, 4 to R.plurals.gallery_stat_instructions)

    @Test
    fun `Kennzahlen der Sammlung brechen bei 200 Prozent um und bleiben ganz sichtbar`() {
        zeige(schrift = 2f) {
            Box(Modifier.width(360.dp)) {
                KennzahlenReihe {
                    kennzahlen.forEach { (n, id) -> GalleryStatChip(n, id) }
                }
            }
        }
        val rand = 360f * ctx.resources.displayMetrics.density
        kennzahlen.forEach { (n, id) ->
            val text = ctx.resources.getQuantityString(id, n, fmtInt(n))
            val b = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("„$text“ ragt über den Rand ($b, Rand $rand)", b.right <= rand + 1f && b.width > 0f)
        }
    }

    @Test
    fun `Kennzahlen im Detail brechen bei 200 Prozent um und bleiben ganz sichtbar`() {
        val werte = listOf(ctx.getString(R.string.detail_year) to "2017", ctx.getString(R.string.detail_minifigs) to "7",
            ctx.getString(R.string.detail_theme) to "Star Wars")
        zeige(schrift = 2f) {
            Box(Modifier.width(360.dp)) {
                KennzahlenReihe {
                    werte.forEach { (label, wert) -> StatChipV2(label, wert) }
                }
            }
        }
        val rand = 360f * ctx.resources.displayMetrics.density
        werte.forEach { (label, wert) ->
            val b = compose.onNodeWithText("$label $wert", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("„$label $wert“ ragt über den Rand ($b, Rand $rand)", b.right <= rand + 1f && b.width > 0f)
        }
    }

    /**
     * Offline ist kein Fehler (die Änderungen sind gesichert): Die Fläche des Banners
     * ist nicht rot. Gemessen am Bild, einen Fleck innen am rechten Rand.
     */
    @Test
    fun `Offline-Hinweis meldet keinen Fehler mit roter Flaeche`() {
        zeige {
            Geruest(remember { SnackbarHostState() }, offen = 3) {
                Column { OfflineHinweis(1_793_000_000_000L) }
            }
        }
        val warten = ctx.resources.getQuantityString(R.plurals.offline_warten, 3, 3)
        val bild = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion) and
            hasAnyDescendant(hasText(warten)), useUnmergedTree = true).captureToImage().toPixelMap()
        val p = bild[bild.width - 12, bild.height / 2]
        assertTrue("Banner-Fläche rötlich: $p", p.red - p.blue < 0.08f)
    }

    /** Der Chip über der Anmeldung wechselt den Server: Das hört TalkBack als Schaltfläche. */
    @Test
    fun `Server-Chip nennt seine Aufgabe als Schaltflaeche`() {
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

    private val katalogDetail = KatalogDetailAnsicht(
        setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
        numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
        bricklink = BrickLinkAnsicht(number = "10305-1",
            url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))

    /**
     * Auf dem Tablet stehen Bezeichnung und Wert nahe beieinander und die Knöpfe in
     * Bedienbreite; die Teilezahl trägt den Tausendertrenner wie überall.
     */
    @Test
    fun `Detailkarten stehen auf dem Tablet in Lesebreite`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige {
            CatalogDetailScreen(setNumber = "10305-1", detail = katalogDetail,
                isLoading = false, imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "", onLoad = {},
                onAddToGallery = { _, _, _, _, _, _ -> }, onWish = { _, _, _, _, _ -> },
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
            aufnehmen.width / dichte <= Lesebreite.bedienung.value + 1f)
        compose.onNodeWithText(fmtInt(4514)).fetchSemanticsNode()
    }

    @Test
    fun `Katalog-Detail steht auf dem Tablet in zwei Spalten, Aufnehmen vor BrickLink`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige {
            CatalogDetailScreen(setNumber = "10305-1", detail = katalogDetail,
                isLoading = false, imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "", onLoad = {},
                onAddToGallery = { _, _, _, _, _, _ -> }, onWish = { _, _, _, _, _ -> },
                onOpenInGallery = {}, onBack = {})
        }
        // Der Name steht einmal da, in der Leiste wie im Set-Detail; die Angaben rechts vom Bild.
        compose.onAllNodesWithText("Lion Knights' Castle").assertCountEquals(1)
        val nummer = compose.onNodeWithText("10305-1").fetchSemanticsNode().boundsInRoot
        val bild = compose.onNode(hasTestTag(BILD_ERSATZ), useUnmergedTree = true)
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
    fun `Finanzen nennen den Marktwert vor dem Verlauf`() {
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            zeige { FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build()) }
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
