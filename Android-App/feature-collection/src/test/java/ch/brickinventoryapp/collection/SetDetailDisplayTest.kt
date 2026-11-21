package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.domain.Geld
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.SetPriceView
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import ch.brickinventoryapp.collection.ui.screens.SetDetailScreen
import ch.brickinventoryapp.collection.ui.screens.SetDetailZustand
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailAktionen
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.model.file.FileRef
import coil3.ImageLoader
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Das Set-Detail, gezeichnet mit festem Zustand: Kaufpreis, Marktpreis und Mengenregler,
 * wie der Nutzer sie sieht. Ersetzt die Quelltext-Prüfungen in PurchasePriceDisplayTest
 * und ServerComputedValuesTest (core-data las dafür Bildschirme aus feature-collection).
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Patches unter gegenproben/):
 *   kaufkachel-letzter-kauf     die Kaufpreis-Kachel zeigt maxPurchasePrice → rot „die Kaufpreis-Kachel …“
 *   marktpreis-doppelt          die Preiskarte zeigt den Marktpreis noch einmal → rot „der Marktpreis …“
 *   mengenregler-ohne-kopplung  `remember(set.setNumber)` ohne set.quantity → rot „der Mengenregler …“
 *   verlauf-fehler-ohne-klasse  ErrorHint des Preisverlaufs ohne historyFetch.art → rot „scheitert der Preisverlauf …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1000dp-h900dp-land")
class SetDetailDisplayTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private class Aktionen : SetDetailAktionen {
        val schritte = mutableListOf<Int>()
        override fun refresh() = Unit
        override fun setPriceAlert(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand) = Unit
        override fun changeQuantityUm(setNumber: String, schritt: Int) { schritte += schritt }
        override fun setSetLocation(setNumber: String, ort: String) = Unit
        override fun loadLocationStock(besitzer: List<Int>) = Unit
        override fun loadInstructionHigh(setNumber: String, datei: FileRef) = Unit
        override fun loescheAnleitung(setNumber: String, instrId: Int) = Unit
    }

    private val falcon = SetAnsicht("75192-1", name = "Millennium Falcon", quantity = 5,
        avgPurchasePrice = Geld.aus(712.5), maxPurchasePrice = Geld.aus(800.0))
    private val preis = SetPriceView("75192-1", Waehrung.CHF, avgPrice = Geld.aus(1249.9))

    private fun zustand(set: SetAnsicht) = SetDetailZustand(AppUiState(currency = Waehrung.CHF),
        SetDetailUiState(setDetail = set, setPrice = preis), LagerUiState())

    private fun anzahl(text: String) = compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().size

    @Test
    fun `the purchase price tile shows the quantity-weighted average, not the last purchase`() {
        val bilder = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", zustand = zustand(falcon), aktionen = Aktionen(),
                    serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        assertEquals(1, anzahl(fmtMoney(712.5, Waehrung.CHF)))
        assertEquals(0, anzahl(fmtMoney(800.0, Waehrung.CHF)))
    }

    @Test
    fun `the market price appears once in the value tiles, not again in the price card`() {
        val bilder = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", zustand = zustand(falcon), aktionen = Aktionen(),
                    serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        // Die Preiskarte ist da (ihr Titel steht neben dem der Kachel), wiederholt den Betrag aber nicht.
        assertEquals(2, anzahl(ctx.getString(R.string.detail_section_market)))
        assertEquals(1, anzahl(fmtMoney(1249.9, Waehrung.CHF)))
    }

    @Test
    fun `the quantity control follows the quantity the server returns`() {
        val bilder = ImageLoader.Builder(ctx).build()
        val aktionen = Aktionen()
        var set by mutableStateOf(falcon)
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", zustand = zustand(set), aktionen = aktionen,
                    serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.cd_qty_decrease)).onFirst().performClick()
        compose.waitForIdle()
        assertEquals(listOf(-1), aktionen.schritte)
        assertEquals("der Regler zählt sofort", 1, anzahl("4"))
        // Fremde Exemplare lassen sich nicht wegnehmen: Der Server deckelt und meldet 3.
        set = falcon.copy(quantity = 3)
        compose.waitForIdle()
        assertEquals(1, anzahl("3"))
        assertEquals(0, anzahl("4"))
    }

    @Test
    fun `if the price history fails, the advice of its error class is shown`() {
        val bilder = ImageLoader.Builder(ctx).build()
        val withoutNetwork = SetDetailZustand(AppUiState(currency = Waehrung.CHF),
            SetDetailUiState(setDetail = falcon, setPrice = preis,
                historyFetch = Laden.Fehler(Fehlerklasse.OFFLINE, Meldung.Text("Zeitüberschreitung"))), LagerUiState())
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", zustand = withoutNetwork, aktionen = Aktionen(),
                    serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        val rat = ctx.getString(R.string.fehler_offline_text)
        // Die Preiskarte liegt unten in der Liste; welcher Rollbereich sie trägt, hängt an der Breite.
        val areas = compose.onAllNodes(hasScrollToNodeAction())
        for (i in areas.fetchSemanticsNodes().indices) {
            try { areas[i].performScrollToNode(hasText(rat)); break } catch (_: AssertionError) { continue }
        }
        assertEquals("Ohne Klasse stand nur „Laden fehlgeschlagen“", 1, anzahl(rat))
    }
}
