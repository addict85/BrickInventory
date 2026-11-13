package ch.brickinventoryapp.sammlung

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.model.ui.model.SetPreisAnsicht
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.SetDetailUiState
import ch.brickinventoryapp.sammlung.ui.screens.SetDetailScreen
import ch.brickinventoryapp.sammlung.ui.screens.SetDetailZustand
import ch.brickinventoryapp.sammlung.ui.viewmodel.SetDetailAktionen
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.zustand.ui.LagerUiState
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
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
 * und ServerComputedValuesTest (core-data las dafür Bildschirme aus feature-sammlung).
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Patches unter gegenproben/):
 *   kaufkachel-letzter-kauf     die Kaufpreis-Kachel zeigt maxPurchasePrice → rot „die Kaufpreis-Kachel …“
 *   marktpreis-doppelt          die Preiskarte zeigt den Marktpreis noch einmal → rot „der Marktpreis …“
 *   mengenregler-ohne-kopplung  `remember(set.setNumber)` ohne set.quantity → rot „der Mengenregler …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1000dp-h900dp-land")
class SetDetailAnzeigeTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private class Aktionen : SetDetailAktionen {
        val schritte = mutableListOf<Int>()
        override fun aktualisiere() = Unit
        override fun setzePreisalarm(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand) = Unit
        override fun aendereMengeUm(setNumber: String, schritt: Int) { schritte += schritt }
        override fun setzeSetLagerort(setNumber: String, ort: String) = Unit
        override fun loadLagerortVorrat(besitzer: List<Int>) = Unit
        override fun ladeAnleitungHoch(setNumber: String, datei: DateiRef) = Unit
        override fun loescheAnleitung(setNumber: String, instrId: Int) = Unit
    }

    private val falke = SetAnsicht("75192-1", name = "Millennium Falcon", quantity = 5,
        avgPurchasePrice = 712.5, maxPurchasePrice = 800.0)
    private val preis = SetPreisAnsicht("75192-1", Waehrung.CHF, avgPrice = 1249.9)

    private fun zustand(set: SetAnsicht) = SetDetailZustand(AppUiState(currency = Waehrung.CHF),
        SetDetailUiState(setDetail = set, setPrice = preis), LagerUiState())

    private fun anzahl(text: String) = compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().size

    @Test
    fun `die Kaufpreis-Kachel zeigt den mengengewichteten Schnitt, nicht den letzten Kauf`() {
        val bilder = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", zustand = zustand(falke), aktionen = Aktionen(),
                    serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        assertEquals(1, anzahl(fmtMoney(712.5, Waehrung.CHF)))
        assertEquals(0, anzahl(fmtMoney(800.0, Waehrung.CHF)))
    }

    @Test
    fun `der Marktpreis steht einmal in den Wert-Kacheln, nicht noch einmal in der Preiskarte`() {
        val bilder = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", zustand = zustand(falke), aktionen = Aktionen(),
                    serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        // Die Preiskarte ist da (ihr Titel steht neben dem der Kachel), wiederholt den Betrag aber nicht.
        assertEquals(2, anzahl(ctx.getString(R.string.detail_section_market)))
        assertEquals(1, anzahl(fmtMoney(1249.9, Waehrung.CHF)))
    }

    @Test
    fun `der Mengenregler folgt der Menge, die der Server zurueckgibt`() {
        val bilder = ImageLoader.Builder(ctx).build()
        val aktionen = Aktionen()
        var set by mutableStateOf(falke)
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
        set = falke.copy(quantity = 3)
        compose.waitForIdle()
        assertEquals(1, anzahl("3"))
        assertEquals(0, anzahl("4"))
    }
}
