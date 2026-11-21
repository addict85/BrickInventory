package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.inGroupsOfFour
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Voucher numbers stand in even groups of four, the same way the
 * issuer separated them.
 *
 * Counter-check: `filter { it.isLetterOrDigit() }` removed →
 * red in both tests with separators.
 * Counter-check: the exception for the mask removed → red
 * “the server's mask stays” (“3333” instead of “…3333”).
 */
class GroupsOfFourTest {

    @Test
    fun `hyphens and spaces of the issuer disappear`() {
        assertEquals("6036 1234 5678", inGroupsOfFour("6036-1234 5678"))
    }

    @Test
    fun `the rest stands as a short last group`() {
        assertEquals("AB12 CD34 5", inGroupsOfFour("AB12-CD34-5"))
    }

    @Test
    fun `without separators the grouping by four stays`() {
        assertEquals("1234 5678", inGroupsOfFour("12345678"))
    }

    @Test
    fun `the server's mask stays`() {
        assertEquals("…3333", inGroupsOfFour("…3333"))
    }
}
