package ch.brickinventoryapp

import ch.brickinventoryapp.ui.model.LagerortAnsicht
import ch.brickinventoryapp.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.ui.Filterzahl
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Zahl am Knopf „Filter“ zählt, was die Liste wirklich einschränkt — nicht,
 * was nur gemerkt ist, und nicht die Sortierung (eigenes Menü, SortierMenue).
 *
 * Gegenproben (28.10.2026, gemessen mit kotlinc gegen ui/Filterzahl.kt):
 *   A  in konto() die Prüfung `wert in moeglich` entfernt → rot „ein Konto,
 *      das nicht mehr zum Haushalt gehört, zählt nicht“
 *   B  in lager() nur auf `isNotBlank` geprüft → rot „ein leerer Lagerort
 *      zählt nicht“
 *   C  in galerie() das Thema nicht gezählt → rot „jede Abweichung zählt
 *      einmal“ (2 statt 3; 03.11.2026, modbau)
 *   D  in teile() die Kategorie vergessen → rot „bei den Teilen zählen …“
 */
class FilterzahlTest {

    private val haushalt = listOf(
        MitgliedAnsicht(id = 1, username = "marco", isSelf = true),
        MitgliedAnsicht(id = 2, username = "kind"),
    )
    private val orte = listOf(LagerortAnsicht("Keller", sets = 3), LagerortAnsicht("Estrich", teile = 2))

    @Test
    fun `ohne Abweichung steht keine Zahl`() {
        assertEquals(0, Filterzahl.galerie(haushalt, ScopeFilter.ALL, orte, "", ""))
        assertEquals(0, Filterzahl.teile(haushalt, ScopeFilter.ALL, orte, "", "", "", ""))
    }

    @Test
    fun `jede Abweichung zaehlt einmal`() {
        assertEquals(3, Filterzahl.galerie(haushalt, "2", orte, "Keller", "Technic"))
        assertEquals(1, Filterzahl.galerie(haushalt, "own", orte, "", ""))
    }

    @Test
    fun `ein Konto, das nicht mehr zum Haushalt gehoert, zaehlt nicht`() {
        assertEquals(0, Filterzahl.konto(haushalt, "99"))
        // Ohne Haushalt gibt es keinen Kontofilter — ein gemerkter Wert wirkt nicht.
        assertEquals(0, Filterzahl.konto(haushalt.take(1), "own"))
        assertEquals(1, Filterzahl.konto(haushalt, "2"))
    }

    @Test
    fun `ein leerer LagerortAnsicht zaehlt nicht`() {
        assertEquals(0, Filterzahl.lager(orte, "Garage"))
        assertEquals(1, Filterzahl.lager(orte, "Estrich"))
    }

    @Test
    fun `bei den Teilen zaehlen Ersatzteile, Farbe und Kategorie`() {
        assertEquals(3, Filterzahl.teile(haushalt, ScopeFilter.ALL, orte, "", "0", "Red", "Bricks"))
        assertEquals(5, Filterzahl.teile(haushalt, "own", orte, "Keller", "1", "Red", "Bricks"))
    }
}
