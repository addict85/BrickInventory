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
 *      BrickJson.decodeFromString) und in SetItem `set_number` zu `set_nummer`
 *      umbenannt → rot „Set: Nummer, Name, Thema, Jahr“ (die Zeile gälte als unlesbar)
 *   B  in ColumnsFassung2 der Rückfall `?: "N"` bei MERKLISTE entfernt → rot
 *      „Merkposten ohne Zustand“
 *   C  in ColumnsFassung2 `pflicht("set_number")` durch `text("set_number") ?: ""`
 *      ersetzt → rot „Set ohne Nummer ist unlesbar“
 */
class ColumnsFassung2Test {

    // Proben im Format der Fassung 2 (encodeDefaults, Feldnamen des Servers).
    private val set = """{"set_number":"10294-1","name":"Titanic","year":2021,"theme":"Icons","num_parts":9090,
        "condition":"N","storage":"Regal 3","conditions":["N"],"unbekannt":{"x":1}}"""
    private val merkposten = """{"set_number":"75192-1","user_id":2,"name":"Millennium Falcon","year":2017}"""
    private val teil = """{"part_number":"3001","bl_part_number":"3001b","part_name":"Brick 2 x 4","color_id":5,
        "color_name":"Red","category_name":"Bricks","is_spare":true}"""
    private val figur = """{"fig_number":"sw0001","fig_name":"Luke Skywalker","conditions":[]}"""
    private val manualPart = """{"id":7,"part_number":"3020","part_name":"Plate 2 x 4","color_id":0,"user_id":1,"storage":"Kiste"}"""
    private val manualMinifig = """{"id":8,"fig_name":"Ohne Nummer","user_id":1}"""

    @Test
    fun `set - number, name, theme, year in the search text, theme and storage location as columns`() {
        assertEquals("Set: Nummer, Name, Thema, Jahr",
            Filterspalten("10294-1\ntitanic\nicons\n2021", thema = "Icons", lagerort = "Regal 3"),
            ColumnsFassung2.aus("SETS", set))
    }

    @Test
    fun `set without theme and year - empty theme and year 0 as in version 2`() {
        assertEquals(Filterspalten("1-1\n\n0"), ColumnsFassung2.aus("SETS", """{"set_number":"1-1","theme":null}"""))
    }

    @Test
    fun `wishlist item - condition as a column, without condition N applies`() {
        assertEquals(Filterspalten("75192-1\nmillennium falcon", zustand = "N"), ColumnsFassung2.aus("MERKLISTE", merkposten))
        assertEquals("Merkposten ohne Zustand", Filterspalten("", zustand = "N"), ColumnsFassung2.aus("MERKLISTE", "{}"))
        assertEquals(Filterspalten("1-1", zustand = "U"), ColumnsFassung2.aus("MERKLISTE", """{"set_number":"1-1","condition":"U"}"""))
    }

    @Test
    fun `part - color, category and spare part as columns`() {
        assertEquals(Filterspalten("3001\nbrick 2 x 4\n3001b", farbe = "Red", kategorie = "Bricks", ersatzteil = true),
            ColumnsFassung2.aus("TEILE", teil))
        assertEquals(Filterspalten("3002", ersatzteil = false), ColumnsFassung2.aus("TEILE", """{"part_number":"3002"}"""))
    }

    @Test
    fun `figures and manual items`() {
        assertEquals(Filterspalten("sw0001\nluke skywalker"), ColumnsFassung2.aus("FIGUREN", figur))
        assertEquals(Filterspalten("3020\nplate 2 x 4", lagerort = "Kiste"), ColumnsFassung2.aus("MANUELLE_TEILE", manualPart))
        assertEquals(Filterspalten("\nohne nummer"), ColumnsFassung2.aus("MANUELLE_FIGUREN", manualMinifig))
        assertEquals(Filterspalten(), ColumnsFassung2.aus("GUTSCHEINE", """{"id":3}"""))
    }

    @Test
    fun `unreadable rows give null`() {
        assertNull("Set ohne Nummer ist unlesbar", ColumnsFassung2.aus("SETS", "{}"))
        assertNull("Teil ohne Nummer", ColumnsFassung2.aus("TEILE", """{"part_name":"x"}"""))
        assertNull("Figur ohne Nummer", ColumnsFassung2.aus("FIGUREN", """{"fig_name":"x"}"""))
        assertNull("kein Objekt", ColumnsFassung2.aus("SETS", "[1,2]"))
        assertNull("kein JSON", ColumnsFassung2.aus("SETS", "kaputt"))
        assertNull("unbekannte Art", ColumnsFassung2.aus("GIBT_ES_NICHT", set))
    }
}
