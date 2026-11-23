package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.shared.ui.entryInvalid
import ch.brickinventoryapp.shared.ui.entryValues
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The capture dialogs read price and quantity like the number fields (NumericInput).
 *
 * Counter-check (counter-checks/capture-reads-price-raw.patch): entryValues reads the
 * price with replace and toDoubleOrNull again → red „die Erfassung liest den Preis …“.
 */
class EntryValuesTest {

    @Test
    fun `adding reads the price like the field and reports unreadable input`() {
        val household = emptyList<MemberView>()
        // Locale-independent: two separators are never a special case.
        assertEquals(Money.from(1299.0), entryValues("2", "1.299,00", Condition.NEW, null, household).price)
        assertEquals(Money.from(1299.5), entryValues("2", "1,299.50", Condition.NEW, null, household).price)
        assertEquals(false, entryInvalid("", ""))
        assertEquals(false, entryInvalid("3", "1.299,00"))
        assertEquals(true, entryInvalid("0", ""))
        assertEquals(true, entryInvalid("99999999999", ""))
        assertEquals(true, entryInvalid("1", "."))
    }
}
