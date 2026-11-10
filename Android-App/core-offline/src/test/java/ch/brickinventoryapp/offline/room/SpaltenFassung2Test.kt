package ch.brickinventoryapp.offline.room

import ch.brickinventoryapp.offline.Filterspalten
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Die Migration 2 → 3 liest Zeilen der Fassung 2 mit festen JSON-Proben, wie sie
 * damals abgelegt wurden — unabhängig davon, wie die Modelle heute heissen.
 *
 * Gegenproben (lokal mit kotlinc gemessen):
 *   A  MIGRATION_2_3 wieder über die heutigen Modelle (Faecher.SETS.spalten nach
 *      AblageJson.decodeFromString) und in SetItem `set_number` zu `set_nummer`
 *      umbenannt → rot „Set: Nummer, Name, Thema, Jahr“ (die Zeile gälte als unlesbar)
 *   B  in SpaltenFassung2 der Rückfall `?: "N"` bei MERKLISTE entfernt → rot
 *      „Merkposten ohne Zustand“
 *   C  in SpaltenFassung2 `pflicht("set_number")` durch `text("set_number") ?: ""`
 *      ersetzt → rot „Set ohne Nummer ist unlesbar“
 */
class SpaltenFassung2Test {

    // Proben im Format der Fassung 2 (encodeDefaults, Feldnamen des Servers).
    private val set = """{"set_number":"10294-1","name":"Titanic","year":2021,"theme":"Icons","num_parts":9090,
        "condition":"N","storage":"Regal 3","conditions":["N"],"unbekannt":{"x":1}}"""
    private val merkposten = """{"set_number":"75192-1","user_id":2,"name":"Millennium Falcon","year":2017}"""
    private val teil = """{"part_number":"3001","bl_part_number":"3001b","part_name":"Brick 2 x 4","color_id":5,
        "color_name":"Red","category_name":"Bricks","is_spare":true}"""
    private val figur = """{"fig_number":"sw0001","fig_name":"Luke Skywalker","conditions":[]}"""
    private val manuellesTeil = """{"id":7,"part_number":"3020","part_name":"Plate 2 x 4","color_id":0,"user_id":1,"storage":"Kiste"}"""
    private val manuelleFigur = """{"id":8,"fig_name":"Ohne Nummer","user_id":1}"""

    @Test
    fun `Set - Nummer, Name, Thema, Jahr im Suchtext, Thema und Lagerort als Spalten`() {
        assertEquals("Set: Nummer, Name, Thema, Jahr",
            Filterspalten("10294-1\ntitanic\nicons\n2021", thema = "Icons", lagerort = "Regal 3"),
            SpaltenFassung2.aus("SETS", set))
    }

    @Test
    fun `Set ohne Thema und Jahr - leeres Thema und Jahr 0 wie in Fassung 2`() {
        assertEquals(Filterspalten("1-1\n\n0"), SpaltenFassung2.aus("SETS", """{"set_number":"1-1","theme":null}"""))
    }

    @Test
    fun `Merkposten - Zustand als Spalte, ohne Zustand gilt N`() {
        assertEquals(Filterspalten("75192-1\nmillennium falcon", zustand = "N"), SpaltenFassung2.aus("MERKLISTE", merkposten))
        assertEquals("Merkposten ohne Zustand", Filterspalten("", zustand = "N"), SpaltenFassung2.aus("MERKLISTE", "{}"))
        assertEquals(Filterspalten("1-1", zustand = "U"), SpaltenFassung2.aus("MERKLISTE", """{"set_number":"1-1","condition":"U"}"""))
    }

    @Test
    fun `Teil - Farbe, Kategorie und Ersatzteil als Spalten`() {
        assertEquals(Filterspalten("3001\nbrick 2 x 4\n3001b", farbe = "Red", kategorie = "Bricks", ersatzteil = true),
            SpaltenFassung2.aus("TEILE", teil))
        assertEquals(Filterspalten("3002", ersatzteil = false), SpaltenFassung2.aus("TEILE", """{"part_number":"3002"}"""))
    }

    @Test
    fun `Figuren und manuelle Posten`() {
        assertEquals(Filterspalten("sw0001\nluke skywalker"), SpaltenFassung2.aus("FIGUREN", figur))
        assertEquals(Filterspalten("3020\nplate 2 x 4", lagerort = "Kiste"), SpaltenFassung2.aus("MANUELLE_TEILE", manuellesTeil))
        assertEquals(Filterspalten("\nohne nummer"), SpaltenFassung2.aus("MANUELLE_FIGUREN", manuelleFigur))
        assertEquals(Filterspalten(), SpaltenFassung2.aus("GUTSCHEINE", """{"id":3}"""))
    }

    @Test
    fun `unlesbare Zeilen ergeben null`() {
        assertNull("Set ohne Nummer ist unlesbar", SpaltenFassung2.aus("SETS", "{}"))
        assertNull("Teil ohne Nummer", SpaltenFassung2.aus("TEILE", """{"part_name":"x"}"""))
        assertNull("Figur ohne Nummer", SpaltenFassung2.aus("FIGUREN", """{"fig_name":"x"}"""))
        assertNull("kein Objekt", SpaltenFassung2.aus("SETS", "[1,2]"))
        assertNull("kein JSON", SpaltenFassung2.aus("SETS", "kaputt"))
        assertNull("unbekannte Art", SpaltenFassung2.aus("GIBT_ES_NICHT", set))
    }
}
