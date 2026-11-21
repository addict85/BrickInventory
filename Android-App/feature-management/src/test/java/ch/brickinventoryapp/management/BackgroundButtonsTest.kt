package ch.brickinventoryapp.management

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
import ch.brickinventoryapp.model.domain.JobView
import ch.brickinventoryapp.model.domain.JobStatus
import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.BackgroundView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.management.ui.screens.BricksetQueueRow
import ch.brickinventoryapp.management.ui.screens.BackgroundSection
import ch.brickinventoryapp.management.ui.viewmodel.BackgroundUiState
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
 *   auftraege-leeren-ohne-frage   „Leeren“ ruft clearOn sofort → rot „Leeren fragt …“
 *   brickset-loeschen-ohne-frage  das Löschsymbol löscht sofort → rot „Loeschen eines Brickset-Eintrags …“
 *   auftrag-knopf-ohne-art        Auftragsknöpfe ohne contentDescription → rot „jeder Knopf nennt …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH")
class BackgroundButtonsTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int, vararg a: Any) = compose.activity.getString(id, *a)

    private fun job(id: String, art: String, status: JobStatus, set: String?) = JobView(
        id = id, art = art, status = status, attempt = 1, maxVersuche = 3, geplant = false,
        dueAb = null, progressText = null, fehler = null, setNumber = set)

    private val geleert = mutableListOf<String>()
    private val abgebrochen = mutableListOf<String>()
    private val wiederholt = mutableListOf<String>()

    private fun zeige() {
        val ansicht = BackgroundView(
            auftraege = listOf(job("17", "bilder", JobStatus.LAEUFT, "75192-1"),
                               job("18", "preise", JobStatus.FEHLER, null)),
            pausen = emptyList(), bildbedarf = 0, jobProcessRunning = true)
        compose.setContent {
            BrickInventoryManagerTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    BackgroundSection(BackgroundUiState(ansicht), startOn = { _, _ -> }, clearOn = { geleert += it },
                        onAbbrechen = { abgebrochen += it }, retryOn = { wiederholt += it })
                }
            }
        }
        compose.waitForIdle()
    }

    private fun inDialog(text: String) = compose.onNode(hasText(text) and hasClickAction() and hasAnyAncestor(isDialog()))

    private fun button(name: String) =
        compose.onNode(hasContentDescription(name) and hasClickAction()).also { it.fetchSemanticsNode("Kein Knopf „$name“") }

    @Test
    fun `clearing asks first and then clears the one job kind`() {
        zeige()
        val bilder = text(R.string.art_bilder)
        button(text(R.string.hintergrund_leeren_cd, bilder)).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp allein leert schon", emptyList<String>(), geleert)
        inDialog(text(R.string.common_cancel)).performClick()
        compose.waitForIdle()
        assertEquals("Abbrechen leert", emptyList<String>(), geleert)

        button(text(R.string.hintergrund_leeren_cd, bilder)).performScrollTo().performClick()
        compose.waitForIdle()
        inDialog(text(R.string.hintergrund_leeren)).performClick()
        compose.waitForIdle()
        assertEquals(listOf("bilder"), geleert)
    }

    @Test
    fun `every button names the job kind and the set to TalkBack`() {
        zeige()
        val bilder = text(R.string.art_bilder)
        val preise = text(R.string.art_preise)
        for (art in listOf(bilder, preise)) {
            button(text(R.string.hintergrund_jetzt_cd, art))
            button(text(R.string.hintergrund_leeren_cd, art))
        }
        button(text(R.string.aktion_fuer, text(R.string.hintergrund_abbrechen), "$bilder 75192-1")).performScrollTo().performClick()
        button(text(R.string.aktion_fuer, text(R.string.hintergrund_auftrag_wiederholen), preise)).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("17"), abgebrochen)
        assertEquals(listOf("18"), wiederholt)
    }

    @Test
    fun `deleting a Brickset entry asks first`() {
        val geloescht = mutableListOf<String>()
        compose.setContent {
            BrickInventoryManagerTheme {
                BricksetQueueRow(BricksetEntryView("75192-1", name = "Millennium Falcon", attempts = 2),
                    onRetry = {}, onDelete = { geloescht += it })
            }
        }
        compose.waitForIdle()
        button(text(R.string.aktion_fuer, text(R.string.common_delete), "75192-1")).performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp allein löscht schon", emptyList<String>(), geloescht)
        inDialog(text(R.string.common_delete)).performClick()
        compose.waitForIdle()
        assertEquals(listOf("75192-1"), geloescht)
        button(text(R.string.aktion_fuer, text(R.string.monitoring_icon_retry), "75192-1"))
    }
}
