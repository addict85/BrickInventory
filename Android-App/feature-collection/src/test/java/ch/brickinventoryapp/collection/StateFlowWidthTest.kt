package ch.brickinventoryapp.collection

import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.session.AppUiState
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Modifier

/**
 * A state flow is as expensive as the number of its collectors: every change to
 * AppUiState recomposes every screen that collects it. The gallery fields
 * (the noisiest state) therefore stay in GalleryUiState, and AppUiState does not grow
 * again. Checked against the compiled classes, not against the source; that a
 * derived part only reports real changes is checked by DerivedStateTest.
 *
 * Counter-checks:
 *   A  `val sets: List<SetView> = emptyList()` added to AppUiState → red
 *      “these gallery fields are back in AppUiState: sets”
 *   B  a test field added to AppUiState → red “AppUiState has 11 fields
 *      (allowed: 10)”
 */
class StateFlowWidthTest {

    private fun fields(k: Class<*>) = k.declaredFields.filterNot { Modifier.isStatic(it.modifiers) }.map { it.name }

    @Test
    fun `the gallery fields stay out of the common state`() {
        val gallery = fields(GalleryUiState::class.java)
        assertTrue("only ${gallery.size} fields in GalleryUiState", gallery.size >= 8)
        val fallback = gallery.filter { it in fields(AppUiState::class.java) }
        assertTrue("these gallery fields stand in AppUiState again: ${fallback.joinToString()}", fallback.isEmpty())
    }

    @Test
    fun `the common state does not grow again`() {
        // Whoever lands here checks whether the field really belongs to everyone, instead of raising the number.
        val n = fields(AppUiState::class.java).size
        assertTrue("AppUiState has $n fields (allowed: 10)", n <= 10)
    }
}
