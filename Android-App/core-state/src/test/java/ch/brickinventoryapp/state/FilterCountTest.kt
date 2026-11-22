package ch.brickinventoryapp.state

import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.state.ui.FilterCount
import org.junit.Assert.assertEquals
import org.junit.Test
import ch.brickinventoryapp.model.data.SparePartChoice

/**
 * The number on the „Filter“ button counts what really narrows the list — not
 * what is merely remembered, and not sorting (its own menu, SortMenu).
 *
 * Counter-checks:
 *   A  in account() the check `value in possible` removed → red „ein Konto,
 *      das nicht mehr zum Haushalt gehört, zählt nicht“
 *   B  in storage() only checked against `isNotBlank` → red „ein leerer Lagerort
 *      zählt nicht“
 *   C  in gallery() the theme not counted → red „jede Abweichung zählt
 *      einmal“ (2 instead of 3)
 *   D  in parts() the category forgotten → red „bei den Teilen zählen …“
 */
class FilterCountTest {

    private val household = listOf(
        MemberView(id = 1, username = "marco", isSelf = true),
        MemberView(id = 2, username = "kind"),
    )
    private val locations = listOf(LocationView("Keller", sets = 3), LocationView("Estrich", parts = 2))

    @Test
    fun `without deviation no number is shown`() {
        assertEquals(0, FilterCount.gallery(household, ScopeFilter.ALL, locations, "", ""))
        assertEquals(0, FilterCount.parts(household, ScopeFilter.ALL, locations, "", SparePartChoice.ALL, ColorPicker.All, CategoryChoice.All))
    }

    @Test
    fun `every deviation counts once`() {
        assertEquals(3, FilterCount.gallery(household, "2", locations, "Keller", "Technic"))
        assertEquals(1, FilterCount.gallery(household, "own", locations, "", ""))
    }

    @Test
    fun `an account that no longer belongs to the household does not count`() {
        assertEquals(0, FilterCount.account(household, "99"))
        // Without a household there's no account filter — a remembered value has no effect.
        assertEquals(0, FilterCount.account(household.take(1), "own"))
        assertEquals(1, FilterCount.account(household, "2"))
    }

    @Test
    fun `an empty StorageLocationView does not count`() {
        assertEquals(0, FilterCount.storage(locations, "Garage"))
        assertEquals(1, FilterCount.storage(locations, "Estrich"))
    }

    @Test
    fun `for the parts spare parts, color and category count`() {
        assertEquals(3, FilterCount.parts(household, ScopeFilter.ALL, locations, "", SparePartChoice.WITHOUT, ColorPicker.Color("Red"), CategoryChoice.Category("Bricks")))
        assertEquals(5, FilterCount.parts(household, "own", locations, "Keller", SparePartChoice.ONLY, ColorPicker.Color("Red"), CategoryChoice.Category("Bricks")))
    }
}
