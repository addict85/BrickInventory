package ch.brickinventoryapp.verwaltung

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.model.fach.AuftragAnsicht
import ch.brickinventoryapp.model.fach.AuftragStatus
import ch.brickinventoryapp.model.fach.BricksetEintragAnsicht
import ch.brickinventoryapp.model.fach.HintergrundAnsicht
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.verwaltung.ui.screens.BricksetQueueRow
import ch.brickinventoryapp.verwaltung.ui.screens.HintergrundSection
import ch.brickinventoryapp.verwaltung.ui.viewmodel.HintergrundUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die Knöpfe der Hintergrundarbeiten, gezeichnet: „Leeren“ einer Auftragsart und
 * „Löschen“ eines Brickset-Eintrags fragen erst nach, Abbrechen in der Rückfrage tut
 * nichts. Jeder Knopf nennt TalkBack, woran er wirkt (Auftragsart, Set).
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   auftraege-leeren-ohne-frage   „Leeren“ ruft onLeeren sofort → rot „Leeren fragt …“
 *   brickset-loeschen-ohne-frage  das Löschsymbol löscht sofort → rot „Loeschen eines Brickset-Eintrags …“
 *   auftrag-knopf-ohne-art        Auftragsknöpfe ohne contentDescription → rot „jeder Knopf nennt …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH")
class HintergrundKnoepfeTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int, vararg a: Any) = compose.activity.getString(id, *a)

    private fun auftrag(id: String, art: String, status: AuftragStatus, set: String?) = AuftragAnsicht(
        id = id, art = art, status = status, versuch = 1, maxVersuche = 3, geplant = false,
        faelligAb = null, fortschrittText = null, fehler = null, setNumber = set)

    private val geleert = mutableListOf<String>()
    private val abgebrochen = mutableListOf<String>()
    private val wiederholt = mutableListOf<String>()

    private fun zeige() {
        val ansicht = HintergrundAnsicht(
            auftraege = listOf(auftrag("17", "bilder", AuftragStatus.LAEUFT, "75192-1"),
                               auftrag("18", "preise", AuftragStatus.FEHLER, null)),
            pausen = emptyList(), bildbedarf = 0, jobProzessLaeuft = true)
        compose.setContent {
            BrickInventoryManagerTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    HintergrundSection(HintergrundUiState(ansicht), onStarten = { _, _ -> }, onLeeren = { geleert += it },
                        onAbbrechen = { abgebrochen += it }, onWiederholen = { wiederholt += it })
                }
            }
        }
        compose.waitForIdle()
    }

    private fun imDialog(text: String) = compose.onNode(hasText(text) and hasClickAction() and hasAnyAncestor(isDialog()))

    private fun knopf(name: String) =
        compose.onNode(hasContentDescription(name) and hasClickAction()).also { it.fetchSemanticsNode("Kein Knopf „$name“") }

    @Test
    fun `Leeren fragt erst nach und leert dann die eine Auftragsart`() {
        zeige()
        val bilder = text(R.string.art_bilder)
        knopf(text(R.string.hintergrund_leeren_cd, bilder)).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp allein leert schon", emptyList<String>(), geleert)
        imDialog(text(R.string.common_cancel)).performClick()
        compose.waitForIdle()
        assertEquals("Abbrechen leert", emptyList<String>(), geleert)

        knopf(text(R.string.hintergrund_leeren_cd, bilder)).performScrollTo().performClick()
        compose.waitForIdle()
        imDialog(text(R.string.hintergrund_leeren)).performClick()
        compose.waitForIdle()
        assertEquals(listOf("bilder"), geleert)
    }

    @Test
    fun `jeder Knopf nennt TalkBack die Auftragsart und das Set`() {
        zeige()
        val bilder = text(R.string.art_bilder)
        val preise = text(R.string.art_preise)
        for (art in listOf(bilder, preise)) {
            knopf(text(R.string.hintergrund_jetzt_cd, art))
            knopf(text(R.string.hintergrund_leeren_cd, art))
        }
        knopf(text(R.string.aktion_fuer, text(R.string.hintergrund_abbrechen), "$bilder 75192-1")).performScrollTo().performClick()
        knopf(text(R.string.aktion_fuer, text(R.string.hintergrund_auftrag_wiederholen), preise)).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("17"), abgebrochen)
        assertEquals(listOf("18"), wiederholt)
    }

    @Test
    fun `Loeschen eines Brickset-Eintrags fragt erst nach`() {
        val geloescht = mutableListOf<String>()
        compose.setContent {
            BrickInventoryManagerTheme {
                BricksetQueueRow(BricksetEintragAnsicht("75192-1", name = "Millennium Falcon", attempts = 2),
                    onRetry = {}, onDelete = { geloescht += it })
            }
        }
        compose.waitForIdle()
        knopf(text(R.string.aktion_fuer, text(R.string.common_delete), "75192-1")).performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp allein löscht schon", emptyList<String>(), geloescht)
        imDialog(text(R.string.common_delete)).performClick()
        compose.waitForIdle()
        assertEquals(listOf("75192-1"), geloescht)
        knopf(text(R.string.aktion_fuer, text(R.string.monitoring_icon_retry), "75192-1"))
    }
}
