package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.shared.ui.EntryValues
import ch.brickinventoryapp.shared.ui.entryValues
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The conversion of the inputs of the manual entry dialogs: without a household no owner goes
 * along, otherwise the chosen one. That every adding path asks for the owner and sends it is
 * checked on the rendered dialogs (EntryPathsTest in feature-collection and feature-parts,
 * CatalogEntryDialogsTest).
 *
 * Counter-check (run here): in entryValues `household.size > 1` → `household.size > 0` →
 * red “without a household no owner goes along”.
 */
class AddPathOwnerTest {

    @Test
    fun `without a household no owner goes along`() {
        val alone = listOf(MemberView(id = 1, username = "ich", isSelf = true))
        val household = alone + MemberView(id = 7, username = "lea")
        assertEquals("without a household the app would overwrite a server default with an ID nobody chose",
            EntryValues(count = 1, price = Money.from(2.5), condition = Condition.USED, owner = null),
            entryValues(count = "", price = "2,50", condition = Condition.USED, owner = 7, household = alone))
        assertEquals(EntryValues(count = 3, price = null, condition = Condition.NEW, owner = 7),
            entryValues(count = "3", price = "", condition = Condition.NEW, owner = 7, household = household))
    }
}
