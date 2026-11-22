package ch.brickinventoryapp.collection

import android.content.Context
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import ch.brickinventoryapp.collection.ui.screens.SetDetailScreen
import ch.brickinventoryapp.collection.ui.screens.SetDetailState
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailActions
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.InstructionView
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import coil3.ImageLoader
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The whole manual row opens the PDF, and the trash next to it deletes only its own manual.
 * Rendered in the set detail and tapped; replaces the source checks of the app module.
 *
 * The decorative open icon carries no semantics and is not checked here.
 *
 * Counter-checks (local, Robolectric):
 *   clickable moved from the row onto the icon box → red “tapping the title opens …”
 *                                                    and “the row is the only control …”
 *   a second IconButton with openInstruction        → red “the row is the only control …” (3, not 2)
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1000dp-h900dp-land")
class InstructionRowTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private class Actions : SetDetailActions {
        val deleted = mutableListOf<Int>()
        override fun refresh() = Unit
        override fun setPriceAlert(setNumber: String, direction: AlarmDirection, raw: String, condition: Condition) = Unit
        override fun changeQuantityBy(setNumber: String, step: Int) = Unit
        override fun setSetLocation(setNumber: String, location: String) = Unit
        override fun loadLocationStock(owner: List<Int>) = Unit
        override fun loadInstructionHigh(setNumber: String, file: FileRef) = Unit
        override fun deleteInstruction(setNumber: String, instrId: Int) { deleted += instrId }
    }

    private val server = "https://brick.example"
    private val title = "Bauanleitung Teil 1"
    private val manual = InstructionView(id = 7, url = "https://cdn.example/7.pdf", description = title,
        localPath = "/instructions/7.pdf", isManual = true)
    private val falcon = SetView("75192-1", name = "Millennium Falcon", quantity = 1, instructions = listOf(manual))

    private val actions = Actions()
    private val opened = mutableListOf<Pair<String, String>>()

    private fun show() {
        val condition = SetDetailState(AppUiState(currency = CurrencyCode.CHF),
            SetDetailUiState(setDetail = falcon), StorageUiState())
        val images = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", condition = condition, actions = actions,
                    serverUrl = server, imageLoader = images, onBack = {}, onDelete = {},
                    onOpenPdf = { url, t -> opened += url to t })
            }
        }
        compose.waitForIdle()
        // The manuals sit below the value tiles; which list scrolls depends on the width.
        val areas = compose.onAllNodes(hasScrollToNodeAction())
        for (i in areas.fetchSemanticsNodes().indices) {
            try { areas[i].performScrollToNode(hasText(title)); break } catch (_: AssertionError) { continue }
        }
    }

    @Test
    fun `tapping the title opens the manual from the own server`() {
        show()
        compose.onNodeWithText(title).performClick()
        compose.onNodeWithText("$server/instructions/7.pdf").performClick()
        assertEquals(List(2) { "$server/instructions/7.pdf" to title }, opened)
        assertEquals(emptyList<Int>(), actions.deleted)
    }

    @Test
    fun `the row is the only control that opens the manual`() {
        show()
        val row = compose.onAllNodes(hasClickAction() and hasText(title)).fetchSemanticsNodes().single().boundsInRoot
        // Every control at the height of the row: the row itself and the trash, nothing else.
        val level = compose.onAllNodes(hasClickAction()).fetchSemanticsNodes()
            .filter { it.boundsInRoot.center.y in row.top..row.bottom }
        val delete = ctx.getString(R.string.instr_delete)
        assertEquals(2, level.size)
        assertEquals(listOf(delete), level.flatMap { it.config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() } })
    }

    @Test
    fun `the trash deletes its own manual and does not open it`() {
        show()
        compose.onNodeWithContentDescription(ctx.getString(R.string.instr_delete)).performClick()
        compose.waitForIdle()
        assertEquals(listOf(7), actions.deleted)
        assertEquals(emptyList<Pair<String, String>>(), opened)
    }
}
