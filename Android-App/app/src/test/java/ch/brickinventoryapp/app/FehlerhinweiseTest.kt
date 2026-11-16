package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Laden
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.katalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.screens.KameraErlaubnisHinweis
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

/**
 * Wo die App ewig laden oder einen toten Knopf zeigen könnte, steht ein Grund und ein
 * Weg weiter: Katalog-Detail im Fehler, Kamera dauerhaft verweigert.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   katalog-detail-ewig-laden      Detail ohne Fehlerzweig, nur der Kringel → rot „scheitert das Katalog-Detail, steht …“
 *   kamera-hinweis-ohne-weg        Hinweis zeigt trotz Sperre nur „Erlauben“ → rot „ist die Kamera dauerhaft …“
 *   kamera-hinweis-ohne-zweck      Hinweis ohne Zweck und ohne Eintippen → rot „fehlt die Kamera, sagt …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class FehlerhinweiseTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    private fun zeige(inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `scheitert das Katalog-Detail, steht der Grund mit Erneut versuchen statt des Kringels`() {
        val geladen = mutableListOf<String>()
        zeige {
            CatalogDetailScreen(setNumber = "10305-1",
                geladen = Laden.Fehler(Fehlerklasse.SERVER, Meldung.Text("Server antwortet mit 503")),
                imageLoader = Beispielbilder.loader(ctx), serverUrl = "", onLoad = { geladen += it },
                onAddToGallery = {}, onWish = {}, onOpenInGallery = {}, onBack = {})
        }
        compose.onNodeWithText(ctx.getString(R.string.fehler_server_titel)).fetchSemanticsNode("Keine Überschrift der Fehlerklasse")
        compose.onNodeWithText("Server antwortet mit 503").fetchSemanticsNode("Der Grund fehlt")
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.common_loading)).fetchSemanticsNodes()
            .let { assertEquals("Der Kringel steht noch da", 0, it.size) }
        compose.onNodeWithText(ctx.getString(R.string.common_retry)).performClick()
        compose.waitForIdle()
        assertEquals("Erneut versuchen lädt dasselbe Set", listOf("10305-1", "10305-1"), geladen)
    }

    @Test
    fun `ist die Kamera dauerhaft verweigert, nennt der Hinweis den Weg ueber die Einstellungen`() {
        var getippt = 0
        zeige {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                KameraErlaubnisHinweis("Zweck", "Eintippen", onEintippen = {}, verweigert = true) { getippt++ }
            }
        }
        compose.onNodeWithText(ctx.getString(R.string.scanner_camera_gesperrt)).fetchSemanticsNode("Die Erklärung fehlt")
        compose.onAllNodesWithText(ctx.getString(R.string.scanner_allow)).fetchSemanticsNodes()
            .let { assertEquals("Der tote Knopf steht noch da", 0, it.size) }
        compose.onNodeWithText(ctx.getString(R.string.scanner_camera_einstellungen)).performClick()
        assertEquals(1, getippt)
    }

    @Test
    fun `fehlt die Kamera, sagt der Hinweis wozu und bietet das Eintippen an`() {
        var eingetippt = 0
        val zweck = ctx.getString(R.string.scanner_camera_zweck_barcode)
        val eintippen = ctx.getString(R.string.scanner_nummer_eintippen)
        zeige {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                KameraErlaubnisHinweis(zweck, eintippen, onEintippen = { eingetippt++ }) {}
            }
        }
        compose.onNodeWithText(zweck).fetchSemanticsNode("Der Zweck fehlt")
        compose.onNodeWithText(eintippen).performClick()
        assertEquals("Eintippen führt nicht weiter", 1, eingetippt)
    }
}
