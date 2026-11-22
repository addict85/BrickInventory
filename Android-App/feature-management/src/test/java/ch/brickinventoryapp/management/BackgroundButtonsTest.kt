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
 * The background work's buttons, rendered: "Leeren" for a job kind and
 * "Löschen" for a Brickset entry ask first, cancel in the confirmation prompt does
 * nothing. Every button tells TalkBack what it acts on (job kind, set).
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   auftraege-leeren-ohne-frage   „Leeren“ calls clearOn right away → red “Leeren asks …”
 *   brickset-loeschen-ohne-frage  the delete icon deletes right away → red “deleting a Brickset entry …”
 *   auftrag-knopf-ohne-art        job buttons without contentDescription → red “every button tells …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH")
class BackgroundButtonsTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int, vararg a: Any) = compose.activity.getString(id, *a)

    private fun job(id: String, kind: String, status: JobStatus, set: String?) = JobView(
        id = id, kind = kind, status = status, attempt = 1, maxAttempts = 3, scheduled = false,
        dueFrom = null, progressText = null, error = null, setNumber = set)

    private val emptied = mutableListOf<String>()
    private val cancelled = mutableListOf<String>()
    private val retried = mutableListOf<String>()

    private fun show() {
        val view = BackgroundView(
            jobs = listOf(job("17", "bilder", JobStatus.RUNNING, "75192-1"),
                               job("18", "preise", JobStatus.ERROR, null)),
            pauses = emptyList(), imageDemand = 0, jobProcessRunning = true)
        compose.setContent {
            BrickInventoryManagerTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    BackgroundSection(BackgroundUiState(view), startOn = { _, _ -> }, clearOn = { emptied += it },
                        onCancel = { cancelled += it }, retryOn = { retried += it })
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
        show()
        val images = text(R.string.kind_images)
        button(text(R.string.background_clear_cd, images)).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp allein leert schon", emptyList<String>(), emptied)
        inDialog(text(R.string.common_cancel)).performClick()
        compose.waitForIdle()
        assertEquals("Abbrechen leert", emptyList<String>(), emptied)

        button(text(R.string.background_clear_cd, images)).performScrollTo().performClick()
        compose.waitForIdle()
        inDialog(text(R.string.background_clear)).performClick()
        compose.waitForIdle()
        assertEquals(listOf("bilder"), emptied)
    }

    @Test
    fun `every button names the job kind and the set to TalkBack`() {
        show()
        val images = text(R.string.kind_images)
        val prices = text(R.string.kind_prices)
        for (kind in listOf(images, prices)) {
            button(text(R.string.background_now_cd, kind))
            button(text(R.string.background_clear_cd, kind))
        }
        button(text(R.string.action_for, text(R.string.background_cancel), "$images 75192-1")).performScrollTo().performClick()
        button(text(R.string.action_for, text(R.string.background_job_retry), prices)).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("17"), cancelled)
        assertEquals(listOf("18"), retried)
    }

    @Test
    fun `deleting a Brickset entry asks first`() {
        val deleted = mutableListOf<String>()
        compose.setContent {
            BrickInventoryManagerTheme {
                BricksetQueueRow(BricksetEntryView("75192-1", name = "Millennium Falcon", attempts = 2),
                    onRetry = {}, onDelete = { deleted += it })
            }
        }
        compose.waitForIdle()
        button(text(R.string.action_for, text(R.string.monitoring_queue_remove), "75192-1")).performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp allein löscht schon", emptyList<String>(), deleted)
        inDialog(text(R.string.monitoring_queue_remove)).performClick()
        compose.waitForIdle()
        assertEquals(listOf("75192-1"), deleted)
        button(text(R.string.action_for, text(R.string.monitoring_icon_retry), "75192-1"))
    }
}
