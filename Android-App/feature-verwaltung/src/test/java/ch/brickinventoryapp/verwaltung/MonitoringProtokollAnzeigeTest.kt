package ch.brickinventoryapp.verwaltung

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.data.VorwaermNetz
import ch.brickinventoryapp.model.ui.model.ProtokollZeileAnsicht
import ch.brickinventoryapp.model.util.fmtUhrzeit
import ch.brickinventoryapp.ui.util.appNumberLocale
import android.text.format.DateFormat
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.verwaltung.ui.VerwaltungUiState
import ch.brickinventoryapp.verwaltung.ui.screens.CacheEreignisse
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringScreen
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringZustand
import ch.brickinventoryapp.verwaltung.ui.viewmodel.HintergrundUiState
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringAktionen
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Das Server-Protokoll der Überwachung zeigt zu jeder Zeile die Uhrzeit, wie die
 * Webapp, und lässt sich nach Stufe und Text filtern. Gefiltert wird im Gerät: Die
 * Zeilen sind schon geladen, ein Abruf je Tastendruck wäre nur Wartezeit.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   protokoll-ohne-uhrzeit          die Zeile zeigt loggedAt nicht → rot „jede Zeile nennt …“
 *   protokoll-stufe-filtert-nicht   ein abgewählter Stufen-Chip blendet nichts aus → rot „eine abgewaehlte Stufe …“
 *   protokoll-suche-filtert-nicht   der Suchtext blendet nichts aus → rot „die Suche …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MonitoringProtokollAnzeigeTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private var protokollAbrufe = 0

    private val aktionen = object : MonitoringAktionen {
        override suspend fun ladeJobs() = Unit
        override suspend fun ladeWarteschlange() = Unit
        override suspend fun ladeProtokoll(minuten: Int) { protokollAbrufe++ }
        override suspend fun wiederholeEintrag(setNummer: String) = true
        override suspend fun entferneEintrag(setNummer: String) = true
        override suspend fun leseAnleitungenNeuEin(): Int? = null
        override suspend fun starteCsvAbgleich() = true
        override suspend fun startePreislauf() = true
        override suspend fun ladeFehlendeBilderNach() = true
        override suspend fun reiheKatalogbilderEin() = true
        override suspend fun setzeJobZeitplan(name: String, zeit: String?, minuten: Int?) = true
        override fun auftragAbbrechen(id: String) = Unit
        override fun auftragWiederholen(id: String) = Unit
        override fun auftragsArtStarten(art: String, name: String) = Unit
        override fun auftragsArtLeeren(art: String) = Unit
        override fun melde(satz: String) = Unit
    }

    private val info = ProtokollZeileAnsicht(1, "info", "Preislauf gestartet", "2026-11-10T08:15:30Z")
    private val fehler = ProtokollZeileAnsicht(2, "error", "Abruf bei BrickLink gescheitert", "2026-11-10T09:42:07Z")

    /** Zeichnet die Überwachung mit zwei Protokollzeilen und klappt das Protokoll auf. */
    private fun zeigeOffen() {
        val zustand = MonitoringZustand(MonitoringUiState(), HintergrundUiState(), VerwaltungUiState(protokoll = listOf(info, fehler)),
            mapOf(VorwaermNetz.WLAN to true, VorwaermNetz.MOBIL to false, VorwaermNetz.ROAMING to false), Design.CLASSIC, 0L)
        val cache = CacheEreignisse(vorgabeZustand = {}, ablageLeeren = {}, netz = { _, _ -> }, design = {},
            cacheDauer = {}, cacheLeeren = {}, grenzwerte = { _, _, _ -> })
        compose.setContent { BrickInventoryManagerTheme { MonitoringScreen(zustand, aktionen, cache) } }
        compose.waitForIdle()
        rolleZu(hasText(text(R.string.admin_log_title)))
        compose.onNodeWithContentDescription(text(R.string.common_expand)).performClick()
        compose.waitForIdle()
        rolleZu(hasText(fehler.message!!))
        assertEquals("Geladene Zeilen holt das Aufklappen nicht noch einmal", 0, protokollAbrufe)
    }

    /** Rollt die Liste, die [ziel] enthält; neben ihr rollen kleinere Reihen. */
    private fun rolleZu(ziel: SemanticsMatcher) {
        val listen = compose.onAllNodes(hasScrollAction()).fetchSemanticsNodes().size
        assertTrue("Nichts gefunden, das zu ${ziel.description} rollt", (0 until listen).any { i ->
            runCatching { compose.onAllNodes(hasScrollAction())[i].performScrollToNode(ziel) }.isSuccess
        })
        compose.waitForIdle()
    }

    private fun anzahl(text: String) = compose.onAllNodes(hasText(text), useUnmergedTree = true).fetchSemanticsNodes().size

    @Test
    fun `jede Zeile nennt ihre Uhrzeit`() {
        zeigeOffen()
        for (zeile in listOf(info, fehler)) {
            // Wie die Zeile sie zeigt: nach der 12/24-Stunden-Einstellung des Geräts.
            val uhrzeit = fmtUhrzeit(zeile.loggedAt, appNumberLocale(), DateFormat.is24HourFormat(compose.activity))!!
            assertEquals("Uhrzeit $uhrzeit zu „${zeile.message}“", 1, anzahl(uhrzeit))
        }
    }

    @Test
    fun `eine abgewaehlte Stufe blendet ihre Zeilen aus`() {
        zeigeOffen()
        assertEquals(1, anzahl(info.message!!))
        compose.onNode(hasText("INFO") and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("Die INFO-Zeile steht noch da", 0, anzahl(info.message!!))
        assertEquals("Die ERROR-Zeile ist mit verschwunden", 1, anzahl(fehler.message!!))
    }

    @Test
    fun `die Suche blendet Zeilen ohne den Text aus`() {
        zeigeOffen()
        compose.onNodeWithContentDescription(text(R.string.admin_log_search)).performTextInput("BrickLink")
        compose.waitForIdle()
        assertEquals("Die Zeile ohne den Suchtext steht noch da", 0, anzahl(info.message!!))
        assertEquals("Die passende Zeile ist mit verschwunden", 1, anzahl(fehler.message!!))
    }
}
