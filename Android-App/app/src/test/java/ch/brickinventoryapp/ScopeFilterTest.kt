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

    private fun m(id: Int, name: String, self: Boolean = false, tiefe: Int = 1) =
        HouseholdMember(id, name, self, tiefe)

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
    fun `jede Stufe steht drin, eingerueckt nach Tiefe`() {
        // Seit dem Kontenbaum (Nachtrag 173) enthaelt die Liste JEDEN
        // Nachfahren, nicht nur die direkten Unterkonten — Marcos Festlegung:
        // Ein Eintrag meint immer genau EIN Konto, nie dessen Unterkonten mit.
        // Ein Enkel, der hier fehlte, waere ausser ueber „Alle Konten" gar
        // nicht einzeln zu sehen.
        //
        // Ohne Einrueckung stuenden Kind und Enkel gleichrangig untereinander,
        // und die Auswahl sagte nicht mehr, wer zu wem gehoert.
        val opts = ScopeFilter.options(
            listOf(m(1, "grossvater", self = true, tiefe = 0),
                   m(2, "kind", tiefe = 1),
                   m(3, "enkel", tiefe = 2)),
            "Alle", "Eigene")
        assertEquals(
            listOf("all" to "Alle", "own" to "Eigene",
                   "2" to "kind", "3" to "   enkel"),
            opts)
    }

    @Test
    fun `eine fehlende Stufe rueckt nicht ins Nichts`() {
        // Die Vorgabe von `tiefe` ist 1 — eine aeltere Serverfassung ohne das
        // Feld zeigt die Liste damit flach, aber vollstaendig. Ein Wert von 0
        // oder negativ (kaputte Antwort) darf keine negative Wiederholung
        // ergeben; coerceAtLeast(0) faengt das ab.
        val opts = ScopeFilter.options(
            listOf(m(1, "ich", self = true, tiefe = 0), m(2, "lea", tiefe = 0)),
            "Alle", "Eigene")
        assertEquals("lea", opts.last().second)
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
        //
        // „merkliste" ist am 24.09. dazugekommen — Marcos Vorgabe: „In der
        // Merkliste noch einen Filter analog den Sets einbauen inkl. Inhaber."
        // Diese Prüfung hat den Umbau gemeldet, und genau dafür steht sie hier:
        // Die Schlüssel sind der VERTRAG mit der Webapp (SCOPE_VIEWS in
        // public/js/14-scope.js) und mit DataStore. Ein anderer Name hiesse,
        // dass die App die Wahl unter einem Schlüssel speichert, den niemand
        // sonst kennt — sichtbar würde das erst als „der Filter merkt sich
        // nichts".
        val keys = ScopeFilter.View.entries.map { it.key }
        assertEquals(listOf("gallery", "parts", "minifigs", "finance", "merkliste"), keys)
        assertEquals(keys.size, keys.toSet().size)
    }
}
