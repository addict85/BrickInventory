package ch.brickinventoryapp.verwaltung

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import ch.brickinventoryapp.data.VorwaermNetz
import ch.brickinventoryapp.model.fach.JobZustandAnsicht
import ch.brickinventoryapp.model.fach.ZeitplanAnsicht
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.verwaltung.ui.VerwaltungUiState
import ch.brickinventoryapp.verwaltung.ui.screens.CacheEreignisse
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringScreen
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringZustand
import ch.brickinventoryapp.verwaltung.ui.viewmodel.HintergrundUiState
import ch.brickinventoryapp.verwaltung.ui.viewmodel.Jobstart
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die Job-Karten der Überwachung, gezeichnet mit festem Zustand: Der Zeitplan, den der
 * Server mit den Jobs schickt, steht an seiner Karte, und die zwei Bilderknöpfe lösen
 * Verschiedenes aus — Bestandsbilder nachladen gegen Katalogbilder einreihen.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   monitoring-ohne-zeitplan          die Karte bekommt den Zeitplan nicht → rot „der Zeitplan …“
 *   monitoring-bilderknoepfe-gleich   der Katalogknopf lädt Bestandsbilder → rot „die zwei Bilderknöpfe …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MonitoringJobsAnzeigeTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private val gestartet = mutableListOf<Jobstart>()

    private val aktionen = object : StilleAktionen() {
        override fun starte(job: Jobstart) { gestartet += job }
    }

    private fun zeige() {
        val mon = MonitoringUiState(
            jobs = mapOf("prices" to JobZustandAnsicht(label = "Preise"), "imgDl" to JobZustandAnsicht(label = "Bilder")),
            jobSchedules = mapOf("prices" to ZeitplanAnsicht(type = "daily", time = "07:05")),
        )
        val zustand = MonitoringZustand(mon, HintergrundUiState(), VerwaltungUiState(),
            mapOf(VorwaermNetz.WLAN to true, VorwaermNetz.MOBIL to false, VorwaermNetz.ROAMING to false), Design.CLASSIC, 0L)
        val cache = CacheEreignisse(vorgabeZustand = {}, ablageLeeren = {}, netz = { _, _ -> }, design = {},
            cacheDauer = {}, cacheLeeren = {}, grenzwerte = { _, _, _ -> })
        compose.setContent { BrickInventoryManagerTheme { MonitoringScreen(zustand, aktionen, cache) } }
        compose.waitForIdle()
    }

    /** Rollt die Liste, die [ziel] enthält; neben ihr rollen kleinere Reihen. */
    private fun rolleZu(ziel: SemanticsMatcher) {
        val listen = compose.onAllNodes(hasScrollAction()).fetchSemanticsNodes().size
        assertTrue("Nichts gefunden, das zu ${ziel.description} rollt", (0 until listen).any { i ->
            runCatching { compose.onAllNodes(hasScrollAction())[i].performScrollToNode(ziel) }.isSuccess
        })
        compose.waitForIdle()
    }

    @Test
    fun `der Zeitplan des Servers steht an seiner Job-Karte`() {
        zeige()
        rolleZu(hasText("07:05"))
        val knoten: SemanticsNode = compose.onNode(hasText("07:05"), useUnmergedTree = true).fetchSemanticsNode()
        assertTrue(knoten.boundsInRoot.height > 0f)
    }

    @Test
    fun `die zwei Bilderknoepfe loesen Verschiedenes aus`() {
        zeige()
        for (id in listOf(R.string.monitoring_redownload_missing, R.string.monitoring_catalog_images)) {
            val knopf = hasText(text(id)) and hasClickAction()
            rolleZu(knopf)
            compose.onNode(knopf).performClick()
            compose.waitForIdle()
        }
        assertEquals(listOf(Jobstart.BESTANDSBILDER, Jobstart.KATALOGBILDER), gestartet)
    }
}
