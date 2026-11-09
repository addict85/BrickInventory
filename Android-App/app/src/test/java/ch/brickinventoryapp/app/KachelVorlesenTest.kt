package ch.brickinventoryapp.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.ui.model.FigurAnsicht
import ch.brickinventoryapp.model.ui.model.KatalogSetAnsicht
import ch.brickinventoryapp.model.ui.model.TeilAnsicht
import ch.brickinventoryapp.katalog.ui.screens.CatalogSetCard
import ch.brickinventoryapp.teile.ui.screens.MinifigCard
import ch.brickinventoryapp.teile.ui.screens.PartCard
import ch.brickinventoryapp.gemeinsam.ui.TabellenZeile
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtInt
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
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult

/**
 * Was TalkBack an Teile-, Figuren- und Katalogkachel und an der Tabellenzeile liest
 * (der zusammengefasste Knoten zum Antippen): der Name genau einmal, kein „×“ und kein
 * „✓“, und jede Menge mit Einheit („12 Stück“, „4'514 Teile“, „Jahr 2022“). Dazu
 * stehen Name, Farbe und zweite Zeile in mindestens 12 sp (nicht labelSmall).
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   teilekachel-bild-mit-namen    Bild der Teilekachel wieder mit dem Namen beschrieben → rot „Teilekachel …“
 *   menge-als-zeichen             vorgelesenAls() tut nichts → rot in den vier Vorlese-Tests („×“ bzw. „✓“)
 *   teilename-klein               Teilename wieder labelSmall (11 sp) → rot „Name Farbe und zweite Zeile …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class KachelVorlesenTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val bilder = Beispielbilder.loader(ApplicationProvider.getApplicationContext())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    /** Beschreibungen und Texte des antippbaren Knotens, in der Reihenfolge des Baums. */
    private fun vorgelesen(inhalt: @Composable () -> Unit): String {
        compose.setContent {
            BrickInventoryManagerTheme {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        compose.waitForIdle()
        val knoten = compose.onNode(hasClickAction()).fetchSemanticsNode()
        val beschreibung = knoten.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
        val texte = knoten.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        return (beschreibung + texte).joinToString(", ")
    }

    private fun pruefe(was: String, gelesen: String, name: String, einheiten: List<String>) {
        assertEquals("$was: Name nicht genau einmal in „$gelesen“", 1, gelesen.windowed(name.length).count { it == name })
        assertTrue("$was: Zeichen statt Wort in „$gelesen“", '×' !in gelesen && '✓' !in gelesen)
        einheiten.forEach { assertTrue("$was: „$it“ fehlt in „$gelesen“", it in gelesen) }
    }

    @Test
    fun `Teilekachel liest Name einmal und Menge mit Einheit`() {
        // Mit Bild: Nur dann trägt die Kachel eine Bildbeschreibung, die den Namen doppeln könnte.
        val teil = TeilAnsicht(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", totalQuantity = 12,
            imageUrl = "https://cdn.rebrickable.com/media/parts/3001.png")
        val gelesen = vorgelesen { PartCard(teil, serverUrl = "https://brick.example", imageLoader = bilder, onClick = {}) }
        pruefe("Teilekachel", gelesen, "Brick 2 x 4", listOf("12 Stück", "Teil 3001"))
    }

    @Test
    fun `Figurenkachel liest Name einmal und Menge mit Einheit`() {
        val figur = FigurAnsicht(figNumber = "sw0001a", figName = "Battle Droid", quantity = 3, totalQuantity = 3)
        val gelesen = vorgelesen { MinifigCard(figur, serverUrl = "", imageLoader = bilder, onClick = {}) }
        pruefe("Figurenkachel", gelesen, "Battle Droid", listOf("3 Stück", "Figur sw0001a"))
    }

    @Test
    fun `Katalogkachel nennt Jahr Teile und Besitz in Worten`() {
        val set = KatalogSetAnsicht(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022,
            numParts = 4514, owned = true, ownedQuantity = 2)
        val gelesen = vorgelesen { CatalogSetCard(set, imageLoader = bilder, serverUrl = "", onClick = {}) }
        pruefe("Katalogkachel", gelesen, "Lion Knights' Castle",
            listOf("Jahr 2022", "${fmtInt(4514)} Teile", "In der Sammlung, 2 Exemplare", "Set 10305-1"))
    }

    /** Schriftgrösse in sp, wie der Text tatsächlich gesetzt wurde. */
    private fun groesse(text: String): Float {
        val ergebnis = mutableListOf<TextLayoutResult>()
        compose.onNode(androidx.compose.ui.test.hasText(text), useUnmergedTree = true).fetchSemanticsNode()
            .config[SemanticsActions.GetTextLayoutResult].action?.invoke(ergebnis)
        return ergebnis.single().layoutInput.style.fontSize.value
    }

    @Test
    fun `Name Farbe und zweite Zeile stehen in mindestens 12 sp`() {
        val teil = TeilAnsicht(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", totalQuantity = 12)
        vorgelesen {
            Column {
                PartCard(teil, serverUrl = "", imageLoader = bilder)
                TabellenZeile(bildUrl = null, nummer = "3002", name = "Brick 2 x 3", menge = 2, imageLoader = bilder,
                    zweiteZeile = "Bricks", onClick = {})
            }
        }
        val klein = listOf("Brick 2 x 4", "Brick 2 x 3", "Bricks").associateWith { groesse(it) }.filterValues { it < 12f }
        assertTrue("Kerninformation unter 12 sp: $klein", klein.isEmpty())
    }

    @Test
    fun `Tabellenzeile liest Name einmal und Menge mit Einheit`() {
        val gelesen = vorgelesen {
            TabellenZeile(bildUrl = null, nummer = "3001", name = "Brick 2 x 4", menge = 1250, imageLoader = bilder,
                onClick = {})
        }
        pruefe("Tabellenzeile", gelesen, "Brick 2 x 4", listOf("${fmtInt(1250)} Stück"))
    }
}
