package ch.brickinventoryapp.catalog

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import ch.brickinventoryapp.catalog.ui.screens.ThemeRow
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * A row of the theme and year picker is a radio button: TalkBack names role and choice,
 * a checkmark alone only tells those who can see it.
 *
 * Counter-checks (patches under counter-checks/, measured only in the CI — Robolectric):
 *   theme-row-without-role   ThemeRow without radio button role → red “theme and year choice announce …”
 * Counter-check (run here): `selected = selected` removed from the Surface → red
 * “theme and year choice announce …” (no selection state).
 */
@RunWith(RobolectricTestRunner::class)
class ThemeRowRoleTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `theme and year choice announce role and selection`() {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Column {
                    ThemeRow("Alle Themen", false) {}
                    ThemeRow("Icons (21)", true) {}
                }
            }
        }
        for ((text, selected) in listOf("Alle Themen" to false, "Icons (21)" to true)) {
            val row = compose.onNode(hasText(text) and hasClickAction()).fetchSemanticsNode()
            assertEquals("$text: role", Role.RadioButton, row.config.getOrNull(SemanticsProperties.Role))
            assertEquals("$text: selected", selected, row.config.getOrNull(SemanticsProperties.Selected))
        }
    }
}
