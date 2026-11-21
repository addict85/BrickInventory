package ch.brickinventoryapp.collection

import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.collection.ui.GalleryUiState
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
 *   A  `val sets: List<SetAnsicht> = emptyList()` added to AppUiState → red
 *      “these gallery fields are back in AppUiState: sets”
 *   B  a test field added to AppUiState → red “AppUiState has 11 fields
 *      (allowed: 10)”
 */
class StateFlowWidthTest {

    private fun felder(k: Class<*>) = k.declaredFields.filterNot { Modifier.isStatic(it.modifiers) }.map { it.name }

    @Test
    fun `the gallery fields stay out of the common state`() {
        val galerie = felder(GalleryUiState::class.java)
        assertTrue("Nur ${galerie.size} Felder in GalleryUiState", galerie.size >= 8)
        val fallback = galerie.filter { it in felder(AppUiState::class.java) }
        assertTrue("Diese Galerie-Felder stehen wieder in AppUiState: ${fallback.joinToString()}", fallback.isEmpty())
    }

    @Test
    fun `the common state does not grow again`() {
        // Whoever lands here checks whether the field really belongs to everyone, instead of raising the number.
        val n = felder(AppUiState::class.java).size
        assertTrue("AppUiState hat $n Felder (erlaubt: 10)", n <= 10)
    }
}
