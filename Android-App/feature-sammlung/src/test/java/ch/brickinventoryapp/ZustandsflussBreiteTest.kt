package ch.brickinventoryapp

import ch.brickinventoryapp.ui.AppUiState
import ch.brickinventoryapp.ui.GalleryUiState
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Modifier

/**
 * Ein Zustandsfluss ist so teuer wie die Zahl seiner Sammler: Jede Änderung an
 * AppUiState rekomponiert alle Bildschirme, die ihn sammeln. Die Galerie-Felder
 * (der lauteste Zustand) bleiben darum in GalleryUiState, und AppUiState wächst
 * nicht wieder. Geprüft an den übersetzten Klassen, nicht am Quelltext; „wer
 * einen Fluss sammelt, benutzt ihn auch“ steht in UiStateFieldsTest.
 *
 * Gegenproben (31.10.2026, gemessen):
 *   A  `val sets: List<SetAnsicht> = emptyList()` in AppUiState ergänzt → rot
 *      „Diese Galerie-Felder stehen wieder in AppUiState: sets“
 *   B  fünf Probefelder in AppUiState ergänzt → rot „AppUiState hat 16 Felder
 *      (erlaubt: 15)“
 */
class ZustandsflussBreiteTest {

    private fun felder(k: Class<*>) = k.declaredFields.filterNot { Modifier.isStatic(it.modifiers) }.map { it.name }

    @Test
    fun `die Galerie-Felder bleiben aus dem gemeinsamen Zustand heraus`() {
        val galerie = felder(GalleryUiState::class.java)
        assertTrue("Nur ${galerie.size} Felder in GalleryUiState", galerie.size >= 8)
        val rueckfall = galerie.filter { it in felder(AppUiState::class.java) }
        assertTrue("Diese Galerie-Felder stehen wieder in AppUiState: ${rueckfall.joinToString()}", rueckfall.isEmpty())
    }

    @Test
    fun `der gemeinsame Zustand waechst nicht wieder`() {
        // 15 ist der Stand nach der Aufteilung: Wer hier aufschlägt, prüft, ob das
        // Feld wirklich allen gehört, statt die Zahl zu heben.
        val n = felder(AppUiState::class.java).size
        assertTrue("AppUiState hat $n Felder (erlaubt: 15)", n <= 15)
    }
}
