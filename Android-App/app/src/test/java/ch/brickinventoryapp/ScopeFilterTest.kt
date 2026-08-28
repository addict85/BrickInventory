package ch.brickinventoryapp

import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.model.HouseholdMember
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Kontofilter des Haushalts.
 *
 * Übersetzt wird der Wert ausschliesslich auf dem Server; die App reicht ihn
 * als `accounts=` durch. Prüfbar bleibt hier, was die App selbst entscheidet:
 * welche Einträge die Auswahl hat, wann sie verborgen bleibt und wann der Wert
 * überhaupt mitgeschickt wird.
 */
class ScopeFilterTest {

    private fun m(id: Int, name: String, self: Boolean = false) = HouseholdMember(id, name, self)

    @Test
    fun `ohne Unterkonten gibt es nichts zu waehlen`() {
        // Eine Auswahl mit genau einer möglichen Antwort ist keine Wahl,
        // sondern eine Frage, die sich nicht stellt — sie bleibt verborgen.
        assertTrue(ScopeFilter.options(listOf(m(1, "ich", true)), "A", "E").isEmpty())
        assertTrue(ScopeFilter.options(emptyList(), "A", "E").isEmpty())
    }

    @Test
    fun `ein Eintrag je Unterkonto, namentlich`() {
        val opts = ScopeFilter.options(
            listOf(m(1, "eltern", true), m(2, "lea"), m(3, "nino")), "Alle", "Eigene")
        assertEquals(
            listOf("all" to "Alle", "own" to "Eigene", "2" to "lea", "3" to "nino"),
            opts)
    }

    @Test
    fun `kein Sammelposten Unterkonten mehr`() {
        // Auf Marcos Wunsch entfallen: Der Eintrag beantwortete nur „nicht
        // mir" und stand zwischen zwei Einträgen, die dieselbe Frage genauer
        // beantworten. Auch bei mehreren Kindern darf er nicht wieder
        // auftauchen.
        val opts = ScopeFilter.options(
            listOf(m(1, "eltern", true), m(2, "lea"), m(3, "nino")), "Alle", "Eigene")
        assertTrue(opts.none { it.first == "subs" })
        assertEquals(4, opts.size)
    }

    @Test
    fun `all wird nicht mitgeschickt`() {
        // Weglassen hält die Adressen kurz — und trifft im Repository den
        // Zweig, der die Antwort zwischenspeichert: Eine gefilterte Sicht darf
        // dort nicht unter demselben Schlüssel landen wie die volle.
        assertNull(ScopeFilter.asQuery(null))
        assertNull(ScopeFilter.asQuery(""))
        assertNull(ScopeFilter.asQuery(ScopeFilter.ALL))
        assertEquals("own", ScopeFilter.asQuery("own"))
        assertEquals("7", ScopeFilter.asQuery("7"))
    }

    @Test
    fun `eine Wahl auf ein entkoppeltes Konto faellt auf Alle zurueck`() {
        // Sonst stünde in der Auswahl eine leere Beschriftung über einer
        // unerklärlich gefilterten Liste.
        val opts = ScopeFilter.options(listOf(m(1, "eltern", true), m(2, "lea")), "Alle", "Eigene")
        assertEquals("2", ScopeFilter.sanitize("2", opts))
        assertEquals(ScopeFilter.ALL, ScopeFilter.sanitize("99", opts))
        assertEquals(ScopeFilter.ALL, ScopeFilter.sanitize("subs", opts))
    }

    @Test
    fun `jede Ansicht hat ihren eigenen Schluessel`() {
        // Wer in der Galerie den ganzen Haushalt sieht, will in den Finanzen
        // womöglich nur die eigenen Zahlen.
        val keys = ScopeFilter.View.entries.map { it.key }
        assertEquals(listOf("gallery", "parts", "minifigs", "finance"), keys)
        assertEquals(keys.size, keys.toSet().size)
    }
}
