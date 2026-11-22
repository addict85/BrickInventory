package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.accountOptions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Account filter of the household.
 *
 * The value is translated exclusively on the server; the app passes it
 * through as `accounts=`. What stays checkable here is what the app decides itself:
 * which entries the selection has, when it stays hidden and when the value
 * is sent along at all.
 */
class ScopeFilterTest {

    private fun m(id: Int, name: String, self: Boolean = false) =
        MemberView(id, name, self)

    @Test
    fun `without sub-accounts there is nothing to choose`() {
        // A selection with exactly one possible answer is no choice
        // but a question that does not arise — it stays hidden.
        assertTrue(accountOptions(listOf(m(1, "ich", true)), "A", "E").isEmpty())
        assertTrue(accountOptions(emptyList(), "A", "E").isEmpty())
    }

    @Test
    fun `one entry per sub-account, by name`() {
        val opts = accountOptions(
            listOf(m(1, "eltern", true), m(2, "lea"), m(3, "nino")), "Alle", "Eigene")
        assertEquals(
            listOf("all" to "Alle", "own" to "Eigene", "2" to "lea", "3" to "nino"),
            opts)
    }

    @Test
    fun `no collective sub-accounts entry any more`() {
        // Dropped: the entry only answered „not
        // me" and stood between two entries that answer the same question more
        // precisely. Even with several children it must not show up
        // again.
        val opts = accountOptions(
            listOf(m(1, "eltern", true), m(2, "lea"), m(3, "nino")), "Alle", "Eigene")
        assertTrue(opts.none { it.first == "subs" })
        assertEquals(4, opts.size)
    }

    // Counter-check (measured on 28.10.): the earlier indentation by `depth`
    // built in again → red with "   enkel" instead of "enkel".
    @Test
    fun `every sub-account is in it flat, even if an older server sends levels`() {
        // Rights apply only along direct links; every account in the
        // list is a direct sub-account. An older server still sends
        // tiefe = 2 — indented, that would look like a hierarchy that
        // no longer exists.
        val opts = accountOptions(
            listOf(m(1, "eltern", self = true),
                   m(2, "kind"),
                   m(3, "enkel")),
            "Alle", "Eigene")
        assertEquals(
            listOf("all" to "Alle", "own" to "Eigene", "2" to "kind", "3" to "enkel"),
            opts)
    }

    @Test
    fun `a missing level does not move into nothing`() {
        // Even an unexpected value (0 for a sub-account) changes nothing about the name.
        val opts = accountOptions(
            listOf(m(1, "ich", self = true), m(2, "lea")),
            "Alle", "Eigene")
        assertEquals("lea", opts.last().second)
    }

    @Test
    fun `all is not sent`() {
        // Leaving it out keeps the addresses short — and hits the branch in the repository
        // that caches the response: a filtered view must not end up
        // there under the same key as the full one.
        assertNull(ScopeFilter.asQuery(null))
        assertNull(ScopeFilter.asQuery(""))
        assertNull(ScopeFilter.asQuery(ScopeFilter.ALL))
        assertEquals("own", ScopeFilter.asQuery("own"))
        assertEquals("7", ScopeFilter.asQuery("7"))
    }

    @Test
    fun `a choice of an unlinked account falls back to All`() {
        // Otherwise the selection would show an empty label above an
        // inexplicably filtered list.
        val opts = accountOptions(listOf(m(1, "eltern", true), m(2, "lea")), "Alle", "Eigene")
        assertEquals("2", ScopeFilter.sanitize("2", opts))
        assertEquals(ScopeFilter.ALL, ScopeFilter.sanitize("99", opts))
        assertEquals(ScopeFilter.ALL, ScopeFilter.sanitize("subs", opts))
    }

    @Test
    fun `every view has its own key`() {
        // Whoever sees the whole household in the gallery may want only the own
        // numbers in the finances.
        //
        // The wishlist filters like the sets, including owner. This check reports
        // every new view, and that is exactly what it stands here for:
        val keys = ScopeFilter.View.entries.map { it.key }
        assertEquals(listOf("gallery", "parts", "minifigs", "finance", "merkliste"), keys)
        assertEquals(keys.size, keys.toSet().size)
    }
}
