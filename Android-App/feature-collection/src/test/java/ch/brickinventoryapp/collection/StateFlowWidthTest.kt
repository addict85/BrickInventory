package ch.brickinventoryapp.collection

import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.collection.ui.GalleryUiState
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Modifier

/**
 * Ein Zustandsfluss ist so teuer wie die Zahl seiner Sammler: Jede Änderung an
 * AppUiState rekomponiert alle Bildschirme, die ihn sammeln. Die Galerie-Felder
 * (der lauteste Zustand) bleiben darum in GalleryUiState, und AppUiState wächst
 * nicht wieder. Geprüft an den übersetzten Klassen, nicht am Quelltext; dass ein
 * abgeleiteter Teil nur echte Änderungen meldet, prüft DerivedStateTest.
 *
 * Gegenproben:
 *   A  `val sets: List<SetAnsicht> = emptyList()` in AppUiState ergänzt → rot
 *      „Diese Galerie-Felder stehen wieder in AppUiState: sets“
 *   B  ein Probefeld in AppUiState ergänzt → rot „AppUiState hat 11 Felder
 *      (erlaubt: 10)“
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
        // Wer hier aufschlägt, prüft, ob das Feld wirklich allen gehört, statt die Zahl zu heben.
        val n = felder(AppUiState::class.java).size
        assertTrue("AppUiState hat $n Felder (erlaubt: 10)", n <= 10)
    }
}
