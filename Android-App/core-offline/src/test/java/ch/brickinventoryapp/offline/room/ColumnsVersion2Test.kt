package ch.brickinventoryapp.offline.room

import ch.brickinventoryapp.offline.FilterColumns
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The migration 2 → 3 reads rows of version 2 with fixed JSON samples, exactly as they
 * were stored back then — regardless of what the models are called today.
 *
 * Counter-checks (measured locally with kotlinc):
 *   A  MIGRATION_2_3 again via today's models (the SETS slot's columns using
 *      BrickJson.decodeFromString) and in SetItem `set_number` renamed to
 *      `set_nummer` → red „Set: Nummer, Name, Thema, Jahr“ (the row would count as unreadable)
 *   B  in ColumnsVersion2 the fallback `?: "N"` for MERKLISTE removed → red
 *      „Merkposten ohne Zustand“
 *   C  in ColumnsVersion2 `required("set_number")` replaced with `text("set_number") ?: ""`
 *      → red „Set ohne Nummer ist unlesbar“
 */
class ColumnsVersion2Test {

    // Samples in the format of version 2 (encodeDefaults, the server's field names).
    private val set = """{"set_number":"10294-1","name":"Titanic","year":2021,"theme":"Icons","num_parts":9090,
        "condition":"N","storage":"Regal 3","conditions":["N"],"unbekannt":{"x":1}}"""
    private val wantedItem = """{"set_number":"75192-1","user_id":2,"name":"Millennium Falcon","year":2017}"""
    private val part = """{"part_number":"3001","bl_part_number":"3001b","part_name":"Brick 2 x 4","color_id":5,
        "color_name":"Red","category_name":"Bricks","is_spare":true}"""
    private val figure = """{"fig_number":"sw0001","fig_name":"Luke Skywalker","conditions":[]}"""
    private val manualPart = """{"id":7,"part_number":"3020","part_name":"Plate 2 x 4","color_id":0,"user_id":1,"storage":"Kiste"}"""
    private val manualMinifig = """{"id":8,"fig_name":"Ohne Nummer","user_id":1}"""

    @Test
    fun `set - number, name, theme, year in the search text, theme and storage location as columns`() {
        assertEquals("set: number, name, theme, year",
            FilterColumns("10294-1\ntitanic\nicons\n2021", theme = "Icons", storageLocation = "Regal 3"),
            ColumnsVersion2.from("SETS", set))
    }

    @Test
    fun `set without theme and year - empty theme and year 0 as in version 2`() {
        assertEquals(FilterColumns("1-1\n\n0"), ColumnsVersion2.from("SETS", """{"set_number":"1-1","theme":null}"""))
    }

    @Test
    fun `wishlist item - condition as a column, without condition N applies`() {
        assertEquals(FilterColumns("75192-1\nmillennium falcon", condition = "N"), ColumnsVersion2.from("MERKLISTE", wantedItem))
        assertEquals("watchlist item without condition", FilterColumns("", condition = "N"), ColumnsVersion2.from("MERKLISTE", "{}"))
        assertEquals(FilterColumns("1-1", condition = "U"), ColumnsVersion2.from("MERKLISTE", """{"set_number":"1-1","condition":"U"}"""))
    }

    @Test
    fun `part - color, category and spare part as columns`() {
        assertEquals(FilterColumns("3001\nbrick 2 x 4\n3001b", color = "Red", category = "Bricks", sparePart = true),
            ColumnsVersion2.from("TEILE", part))
        assertEquals(FilterColumns("3002", sparePart = false), ColumnsVersion2.from("TEILE", """{"part_number":"3002"}"""))
    }

    @Test
    fun `figures and manual items`() {
        assertEquals(FilterColumns("sw0001\nluke skywalker"), ColumnsVersion2.from("FIGUREN", figure))
        assertEquals(FilterColumns("3020\nplate 2 x 4", storageLocation = "Kiste"), ColumnsVersion2.from("MANUELLE_TEILE", manualPart))
        assertEquals(FilterColumns("\nohne nummer"), ColumnsVersion2.from("MANUELLE_FIGUREN", manualMinifig))
        assertEquals(FilterColumns(), ColumnsVersion2.from("GUTSCHEINE", """{"id":3}"""))
    }

    @Test
    fun `unreadable rows give null`() {
        assertNull("a set without a number is unreadable", ColumnsVersion2.from("SETS", "{}"))
        assertNull("part without a number", ColumnsVersion2.from("TEILE", """{"part_name":"x"}"""))
        assertNull("figure without a number", ColumnsVersion2.from("FIGUREN", """{"fig_name":"x"}"""))
        assertNull("no object", ColumnsVersion2.from("SETS", "[1,2]"))
        assertNull("no JSON", ColumnsVersion2.from("SETS", "kaputt"))
        assertNull("unknown kind", ColumnsVersion2.from("GIBT_ES_NICHT", set))
    }
}
