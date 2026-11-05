package ch.brickinventoryapp

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
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
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.AppUiState
import ch.brickinventoryapp.ui.TeilelisteUiState
import ch.brickinventoryapp.ui.UpdateUiState
import ch.brickinventoryapp.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.components.ErklaerText
import ch.brickinventoryapp.ui.components.GedrosselteAnsage
import ch.brickinventoryapp.ui.components.LadeKreis
import ch.brickinventoryapp.ui.components.Rueckfrage
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.components.katalogName
import ch.brickinventoryapp.ui.model.KatalogSetAnsicht
import ch.brickinventoryapp.ui.model.SetAnsicht
import ch.brickinventoryapp.ui.screens.CatalogSetCard
import ch.brickinventoryapp.ui.screens.CsvImportBanner
import ch.brickinventoryapp.ui.screens.EinstellungenZustand
import ch.brickinventoryapp.ui.screens.FilterAbschnitt
import ch.brickinventoryapp.ui.screens.FilterWahl
import ch.brickinventoryapp.ui.screens.KameraUeberlagerung
import ch.brickinventoryapp.ui.screens.PartsListScreen
import ch.brickinventoryapp.ui.screens.PlPart
import ch.brickinventoryapp.ui.screens.PreisalarmCard
import ch.brickinventoryapp.ui.screens.SetCard
import ch.brickinventoryapp.ui.screens.SettingsScreen
import ch.brickinventoryapp.ui.screens.Suchfeld
import ch.brickinventoryapp.ui.screens.ThemeRow
import ch.brickinventoryapp.ui.screens.Unterseite
import ch.brickinventoryapp.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.viewmodel.DarstellungAktionen
import ch.brickinventoryapp.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.viewmodel.UpdateAktionen
import java.util.Locale
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
 * Die Befunde der Barrierefreiheitsprüfung 17, als Verhalten: Was TalkBack, Tastatur und
 * grosse Schrift an den zentralen Bausteinen vorfinden. Je Test der Befund im Namen.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   schalter-ohne-namen          Kästchen der Bauliste wieder mit eigenem Rückruf → rot „H1 …“
 *   suchfeld-ohne-namen          Suchfeld ohne contentDescription → rot „M5 …“
 *   filterwahl-als-kaestchen     FilterWahl wieder als AuswahlChip → rot „M6 …“
 *   ansage-ungedrosselt          GedrosselteAnsage gibt jeden Wortlaut weiter → rot „M7 …“
 *   bildzoom-nur-geste           Zoomleiste im Bilddialog entfernt → rot „M8 …“
 *   fokus-ohne-rahmen            fokusRahmen zeichnet nichts → rot „M9 …“
 *   csv-aufklapper-stumm         Zustand und Aufklappen am CSV-Balken entfernt → rot „M11 …“
 *   themenzeile-ohne-rolle       ThemeRow ohne Optionsfeld-Rolle → rot „M12 …“
 *   setkachel-name-hinten        Name der Setkachel wieder unter Nummer und Zustand → rot „M13 …“
 *   unterseite-einzeilig         Unterseite wieder mit einzeiligem Titel → rot „M14 …“
 *   rueckfrage-ohne-ueberschrift Titel der Rückfrage ohne heading → rot „N2 …“
 *   notfallcodes-als-wort        Notfallcodes ohne vorgelesenAls → rot „N5 …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class BarrierefreiheitBefundeTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: android.content.Context = ApplicationProvider.getApplicationContext()
    private val bilder = Beispielbilder.loader(ctx)

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

    private fun rolle(n: SemanticsNode) = n.config.getOrNull(SemanticsProperties.Role)

    private fun layout(n: SemanticsNode): TextLayoutResult {
        val ergebnis = mutableListOf<TextLayoutResult>()
        n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        return ergebnis.single()
    }

    /** Text oder Beschreibung je Knoten, in der Reihenfolge des Baums unter [n]. */
    private fun vorgelesen(n: SemanticsNode): List<String> {
        val eigen = n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty() +
            n.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        return eigen + n.children.flatMap { vorgelesen(it) }
    }

    private fun pruefeSchalter(text: String, erwartet: Role, an: Boolean) {
        val knoten = compose.onNode(hasText(text) and isToggleable()).fetchSemanticsNode("„$text“ ist kein Schalter mit Namen")
        assertEquals("$text: Rolle", erwartet, rolle(knoten))
        assertEquals("$text: Zustand", if (an) ToggleableState.On else ToggleableState.Off,
            knoten.config.getOrNull(SemanticsProperties.ToggleableState))
    }

    @Test
    fun `H1 Kaestchen der Bauliste tragen Namen und schalten ueber die Zeile`() {
        var lose: Boolean? = null
        var unter: Boolean? = null
        val teil = PlPart(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", colorHex = "C91A09",
            quantity = 4, imageUrl = null)
        zeige {
            PartsListScreen(TeilelisteUiState(parts = listOf(teil), generated = true), serverUrl = "",
                imageLoader = bilder, onScanBarcode = {}, onNurLose = { lose = it }, onMitUnterkonten = { unter = it },
                hatUnterkonten = true)
        }
        val nurLose = ctx.getString(R.string.partslist_only_loose)
        val mitUnter = ctx.getString(R.string.partslist_include_subs)
        pruefeSchalter(nurLose, Role.Checkbox, false)
        pruefeSchalter(mitUnter, Role.Checkbox, false)
        compose.onNode(hasText(nurLose) and isToggleable()).performClick()
        compose.onNode(hasText(mitUnter) and isToggleable()).performClick()
        compose.waitForIdle()
        assertEquals("Tipp auf die Zeile schaltet „nur lose“", true, lose)
        assertEquals("Tipp auf die Zeile schaltet „mit Unterkonten“", true, unter)
    }

    @Test
    fun `H1 Schalter fuer Preisalarm-Meldungen und Nutzer-Zertifikate tragen Namen`() {
        var ca: Boolean? = null
        val update = object : UpdateAktionen {
            override fun pruefeAufUpdate(still: Boolean) = Unit
            override fun updateHinweisSchliessen() = Unit
            override fun ladeUpdate() = Unit
            override fun starteInstallation() = Unit
        }
        val darstellung = object : DarstellungAktionen {
            override fun setLanguage(languageCode: String) = Unit
            override fun setHelligkeit(wahl: String) = Unit
            override fun setSystemfarben(an: Boolean) = Unit
            override fun setVorschauVerbergen(an: Boolean) = Unit
            override fun setWidgetWerte(an: Boolean) = Unit
        }
        val welt = Beispiele.Welt(KontextTexte())
        try {
            val vm = welt.t.merke(EinstellungenViewModel(welt.t.dienste,
                KontoRepository(welt.t.api, welt.t.cache),
                VerwaltungRepository(welt.t.api, welt.t.cache),
                SetsRepository(welt.t.api, welt.t.cache),
                TeileRepository(welt.t.api, welt.t.cache),
                object : DateiLeser {
                    override suspend fun lies(uri: android.net.Uri): Pair<String?, ByteArray>? = null
                }))
            zeige {
                Column {
                    PreisalarmCard(false) {}
                    SettingsScreen(
                        zustand = EinstellungenZustand(AppUiState(serverUrl = "https://brick.example.org"), UpdateUiState(),
                            "system", "classic", false, false, false, false),
                        aktionen = vm, update = update, darstellung = darstellung, onNutzerCa = { ca = it },
                        onLogout = {}, onServerWechseln = {}, scrollState = androidx.compose.foundation.rememberScrollState(),
                    )
                }
            }
            // Ohne Tipp: Einschalten fragt ab Android 13 die Systemerlaubnis.
            pruefeSchalter(ctx.getString(R.string.alert_notify), Role.Switch, false)
            val nutzerCa = ctx.getString(R.string.settings_nutzer_ca)
            compose.onNode(hasText(nutzerCa) and isToggleable()).performScrollTo()
            pruefeSchalter(nutzerCa, Role.Switch, false)
            compose.onNode(hasText(nutzerCa) and isToggleable()).performClick()
            assertEquals("Tipp auf den Text schaltet", true, ca)
        } finally {
            welt.close()
        }
    }

    @Test
    fun `M5 Suchfeld behaelt seinen Namen nach der Eingabe und bricht bei 200 Prozent um`() {
        val platzhalter = "Nummer oder Name eines Sets im Katalog"
        zeige(schrift = 2f) {
            var wert by remember { mutableStateOf("") }
            Column(Modifier.width(360.dp)) { Suchfeld(wert, { wert = it }, platzhalter) }
        }
        val anzeige = compose.onAllNodes(hasText(platzhalter), useUnmergedTree = true).fetchSemanticsNodes()
            .first { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
        assertTrue("Platzhalter bei 200 % abgeschnitten", !layout(anzeige).hasVisualOverflow)
        compose.onNode(hasSetTextAction()).performTextInput("Falcon")
        compose.waitForIdle()
        val feld = compose.onNode(hasSetTextAction()).fetchSemanticsNode()
        val name = feld.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
        assertTrue("Feld ohne Namen nach der Eingabe: $name", platzhalter in name)
    }

    @Test
    fun `M6 Filterwahl ist eine Einfachwahl mit Ueberschrift und bricht um`() {
        val lang = "Regal Wohnzimmer hinten links · 1 Set"
        zeige(schrift = 2f) {
            Column(Modifier.width(360.dp)) {
                FilterAbschnitt("Lagerort") {
                    FilterWahl("Alle Lagerorte", true) {}
                    FilterWahl(lang, false) {}
                }
            }
        }
        compose.onNode(hasText("Lagerort") and isHeading()).fetchSemanticsNode("„Lagerort“ ist keine Überschrift")
        for ((text, gewaehlt) in listOf("Alle Lagerorte" to true, lang to false)) {
            val chip = compose.onNode(hasText(text) and hasClickAction()).fetchSemanticsNode()
            assertEquals("$text: Rolle", Role.RadioButton, rolle(chip))
            assertEquals("$text: gewählt", gewaehlt, chip.config.getOrNull(SemanticsProperties.Selected))
        }
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.SelectableGroup))
            .fetchSemanticsNode("Die Chips stehen nicht in einer Gruppe")
        val text = compose.onAllNodes(hasText(lang), useUnmergedTree = true).fetchSemanticsNodes()
            .first { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }
        assertTrue("Chiptext bei 200 % abgeschnitten", !layout(text).hasVisualOverflow)
    }

    @Test
    fun `M7 Statusmeldungen sind Live-Regionen und Fortschritt wird gedrosselt angesagt`() {
        var fortschritt by mutableStateOf("Noch 30 s")
        zeige {
            Column {
                KameraUeberlagerung(hinweis = "Näher heran") { }
                LadeKreis(Modifier.width(48.dp))
                GedrosselteAnsage(fortschritt)
            }
        }
        val live = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        compose.onNode(hasText("Näher heran") and live, useUnmergedTree = true).fetchSemanticsNode("Scannerhinweis wird nicht angesagt")
        compose.onNode(hasContentDescription(ctx.getString(R.string.common_loading)) and live)
            .fetchSemanticsNode("Laden wird nicht angesagt")
        // Die Uhr von Hand: Die Ansage darf erst nach zehn Sekunden wechseln.
        compose.mainClock.autoAdvance = false
        fortschritt = "Noch 29 s"
        compose.mainClock.advanceTimeBy(5_000)
        compose.onNode(hasContentDescription("Noch 30 s") and live).fetchSemanticsNode("Nach 5 s schon neu angesagt")
        compose.mainClock.advanceTimeBy(6_000)
        compose.onNode(hasContentDescription("Noch 29 s") and live).fetchSemanticsNode("Nach 10 s nicht neu angesagt")
    }

    @Test
    fun `M8 Bildzoom geht mit Knoepfen und Doppeltipp`() {
        zeige { ZoomableImageDialog(imageUrl = "", contentDescription = "Millennium Falcon", imageLoader = bilder, onDismiss = {}) }
        val gross = ctx.getString(R.string.pdfview_zoom_in)
        val knopf = compose.onNodeWithContentDescription(gross).fetchSemanticsNode()
        assertEquals(Role.Button, rolle(knopf))
        compose.onNodeWithText("100 %").fetchSemanticsNode()
        compose.onNodeWithContentDescription(gross).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("150 %").fetchSemanticsNode("Vergrössern wirkt nicht")
        compose.onNodeWithText("150 %").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("100 %").fetchSemanticsNode("Der Faktor setzt nicht zurück")
        compose.onNode(isDialog()).performTouchInput { doubleClick() }
        compose.waitForIdle()
        compose.onNodeWithText("200 %").fetchSemanticsNode("Doppeltipp zoomt nicht")
    }

    @OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
    @Test
    fun `M9 Tastaturfokus zeigt einen Rahmen in der Hauptfarbe`() {
        var hauptfarbe = 0
        compose.setContent {
            BrickInventoryManagerTheme(theme = "classic") {
                hauptfarbe = MaterialTheme.colorScheme.primary.toArgb()
                val modus = LocalInputModeManager.current
                androidx.compose.runtime.LaunchedEffect(Unit) { modus.requestInputMode(InputMode.Keyboard) }
                Surface(color = MaterialTheme.colorScheme.background) {
                    AppKarte(Modifier.width(200.dp), onClick = {}) { Text("Millennium Falcon", Modifier.width(200.dp)) }
                }
            }
        }
        compose.waitForIdle()
        val karte = compose.onNode(hasClickAction())
        fun randFarbe(): Int {
            val bild = karte.captureToImage().toPixelMap()
            return bild[2, bild.height / 2].toArgb()
        }
        assertTrue("Ohne Fokus schon ein Rahmen", randFarbe() != hauptfarbe)
        karte.performSemanticsAction(SemanticsActions.RequestFocus)
        compose.waitForIdle()
        assertEquals("Fokusrahmen fehlt", hauptfarbe, randFarbe())
    }

    @Test
    fun `M11 CSV-Balken nennt Zustand, Aufklappen und Fortschritt`() {
        zeige {
            CsvImportBanner(done = 3, total = 10, current = "10294-1", ok = 2, warn = 1, err = 0, running = true, onAbbrechen = {})
        }
        val balken = compose.onNode(hasClickAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.StateDescription))
            .fetchSemanticsNode("Der Aufklapper nennt keinen Zustand")
        assertEquals(ctx.getString(R.string.zustand_eingeklappt), balken.config[SemanticsProperties.StateDescription])
        assertTrue("Ohne Aufklappen-Aktion", balken.config.getOrNull(SemanticsActions.Expand) != null)
        assertEquals(ctx.getString(R.string.csv_details_zeigen), balken.config.getOrNull(SemanticsActions.OnClick)?.label)
        assertTrue("Fortschritt mit Zeichen statt Worten: ${vorgelesen(balken)}", vorgelesen(balken).none { '/' in it })
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo,
            ProgressBarRangeInfo(3f, 0f..10f)), useUnmergedTree = true).fetchSemanticsNode("Fortschritt nicht als 3 von 10")
    }

    @Test
    fun `M12 Themen- und Jahreswahl melden Rolle und Wahl`() {
        zeige {
            Column(Modifier.then(Modifier)) {
                ThemeRow("Alle Themen", false) {}
                ThemeRow("Icons (21)", true) {}
            }
        }
        for ((text, an) in listOf("Alle Themen" to false, "Icons (21)" to true)) {
            val zeile = compose.onNode(hasText(text) and hasClickAction()).fetchSemanticsNode()
            assertEquals("$text: Rolle", Role.RadioButton, rolle(zeile))
            assertEquals("$text: gewählt", an, zeile.config.getOrNull(SemanticsProperties.Selected))
        }
    }

    @Test
    fun `M13 Set- und Katalogkachel lesen zuerst den Namen und sind Knoepfe mit Ziel`() {
        val set = SetAnsicht(setNumber = "75192-1", name = "Millennium Falcon", theme = "Star Wars", quantity = 2,
            conditions = listOf("N"))
        val katalog = KatalogSetAnsicht(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022,
            numParts = 4514, owned = true, ownedQuantity = 2)
        zeige {
            Column {
                SetCard(set, "", bilder, onClick = {})
                CatalogSetCard(katalog, imageLoader = bilder, serverUrl = "", onClick = {})
            }
        }
        val oeffnen = ctx.getString(R.string.cd_details_oeffnen)
        for (name in listOf("Millennium Falcon", "Lion Knights' Castle")) {
            // Gefunden im zusammengefassten Baum, gelesen im ungefassten: dort steht die Reihenfolge.
            val id = compose.onNode(hasClickAction() and hasText(name, substring = true)).fetchSemanticsNode("Kachel „$name“").id
            val kachel = compose.onNode(SemanticsMatcher("Knoten $id") { it.id == id }, useUnmergedTree = true).fetchSemanticsNode()
            val gelesen = vorgelesen(kachel).filter { it.isNotBlank() }
            assertEquals("$name zuerst: $gelesen", name, gelesen.first())
            assertEquals("$name genau einmal: $gelesen", 1, gelesen.count { it == name })
            assertEquals("$name: Rolle", Role.Button, rolle(kachel))
            assertEquals("$name: Ziel", oeffnen, kachel.config.getOrNull(SemanticsActions.OnClick)?.label)
        }
    }

    @Test
    fun `M14 lange Titel brechen bei 200 Prozent um und sind Ueberschriften`() {
        val titel = "Slope 45 2 x 2 with Bottom Pin"
        zeige(schrift = 2f) {
            Column(Modifier.width(360.dp)) {
                Unterseite(titel, remember { SnackbarHostState() }, onZurueck = {}) { Text("Inhalt") }
            }
        }
        val knoten = compose.onNode(hasText(titel) and isHeading(), useUnmergedTree = true)
            .fetchSemanticsNode("Titel ist keine Überschrift")
        assertTrue("Titel abgeschnitten", !layout(knoten).hasVisualOverflow)
    }

    @Test
    fun `N2 die Rueckfrage nennt ihren Titel als Ueberschrift und Fenstername`() {
        zeige { Rueckfrage("Abmelden?", "Auf diesem Gerät abmelden.", "Abmelden", {}, {}) }
        compose.onNode(hasText("Abmelden?") and isHeading()).fetchSemanticsNode("Titel ist keine Überschrift")
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, "Abmelden?"))
            .fetchSemanticsNode("Dialog ohne Fenstername")
    }

    @Test
    fun `N3 Mehr erfahren hat je Thema einen eigenen Namen und sagt den Text an`() {
        zeige {
            Column {
                ErklaerText("Kurz eins.", "Mehr eins.", thema = "Preisalarme")
                ErklaerText("Kurz zwei.", "Mehr zwei.", thema = "Haushalt")
            }
        }
        compose.onNodeWithContentDescription("Mehr zu Preisalarme").fetchSemanticsNode()
        compose.onNodeWithContentDescription("Mehr zu Haushalt").performClick()
        compose.waitForIdle()
        compose.onNode(hasText("Mehr zwei.") and SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
            .fetchSemanticsNode("Der aufgeklappte Text wird nicht angesagt")
        compose.onNodeWithText(ctx.getString(R.string.erklaer_weniger)).fetchSemanticsNode("Kein Weg zum Zuklappen")
    }

    @Test
    fun `N4 Katalognamen sind als Englisch ausgezeichnet`() {
        var name: androidx.compose.ui.text.AnnotatedString? = null
        zeige { name = katalogName("Brick 2 x 4") }
        val sprachen = name?.spanStyles?.mapNotNull { it.item.localeList?.firstOrNull()?.language }.orEmpty()
        assertEquals(listOf("en"), sprachen)
    }

    @Test
    fun `N5 Notfallcodes werden Zeichen fuer Zeichen vorgelesen`() {
        zeige {
            ZweiterFaktorPflichtMaske(ZweiterFaktorUiState(aktiv = true, codes = listOf("i9j0-k1l2")), {}, {}, {}, {})
        }
        compose.onNodeWithContentDescription("i 9 j 0 - k 1 l 2").fetchSemanticsNode("Codes als Wort vorgelesen")
    }
}
