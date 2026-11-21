package ch.brickinventoryapp.state

import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.state.ui.Filterzahl
import org.junit.Assert.assertEquals
import org.junit.Test
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/**
 * The number on the „Filter“ button counts what really narrows the list — not
 * what is merely remembered, and not sorting (its own menu, SortierMenu).
 *
 * Counter-checks:
 *   A  in konto() the check `wert in possible` removed → red „ein Konto,
 *      das nicht mehr zum Haushalt gehört, zählt nicht“
 *   B  in lager() only checked against `isNotBlank` → red „ein leerer Lagerort
 *      zählt nicht“
 *   C  in galerie() the theme not counted → red „jede Abweichung zählt
 *      einmal“ (2 instead of 3)
 *   D  in teile() the category forgotten → red „bei den Teilen zählen …“
 */
class FilterzahlTest {

    private val haushalt = listOf(
        MemberView(id = 1, username = "marco", isSelf = true),
        MemberView(id = 2, username = "kind"),
    )
    private val orte = listOf(LocationView("Keller", sets = 3), LocationView("Estrich", teile = 2))

    @Test
    fun `without deviation no number is shown`() {
        assertEquals(0, Filterzahl.galerie(haushalt, ScopeFilter.ALL, orte, "", ""))
        assertEquals(0, Filterzahl.teile(haushalt, ScopeFilter.ALL, orte, "", Ersatzteilwahl.ALLE, ColorPicker.Alle, Kategoriewahl.Alle))
    }

    @Test
    fun `every deviation counts once`() {
        assertEquals(3, Filterzahl.galerie(haushalt, "2", orte, "Keller", "Technic"))
        assertEquals(1, Filterzahl.galerie(haushalt, "own", orte, "", ""))
    }

    @Test
    fun `an account that no longer belongs to the household does not count`() {
        assertEquals(0, Filterzahl.konto(haushalt, "99"))
        // Without a household there's no account filter — a remembered value has no effect.
        assertEquals(0, Filterzahl.konto(haushalt.take(1), "own"))
        assertEquals(1, Filterzahl.konto(haushalt, "2"))
    }

    @Test
    fun `an empty LagerortAnsicht does not count`() {
        assertEquals(0, Filterzahl.lager(orte, "Garage"))
        assertEquals(1, Filterzahl.lager(orte, "Estrich"))
    }

    @Test
    fun `for the parts spare parts, color and category count`() {
        assertEquals(3, Filterzahl.teile(haushalt, ScopeFilter.ALL, orte, "", Ersatzteilwahl.OHNE, ColorPicker.Farbe("Red"), Kategoriewahl.Kategorie("Bricks")))
        assertEquals(5, Filterzahl.teile(haushalt, "own", orte, "Keller", Ersatzteilwahl.NUR, ColorPicker.Farbe("Red"), Kategoriewahl.Kategorie("Bricks")))
    }
}
