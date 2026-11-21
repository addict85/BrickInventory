package ch.brickinventoryapp.offline.room

import ch.brickinventoryapp.offline.Filterspalten
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/**
 * The filter columns of a row as it lay as JSON in version 2 — frozen:
 * a migration runs against old data, even years after a rename in the
 * model. Therefore it reads only the fields the columns need, directly from the
 * JSON instead of via today's model classes. null: the row is not readable.
 */
internal object ColumnsFassung2 {

    fun aus(art: String, inhalt: String): Filterspalten? {
        val o = runCatching { Json.parseToJsonElement(inhalt) as? JsonObject }.getOrNull() ?: return null
        return when (art) {
            "SETS" -> o.pflicht("set_number")?.let { nr ->
                val thema = o.text("theme")
                Filterspalten(suchtext(nr, o.text("name"), thema.orEmpty(), (o.zahl("year") ?: 0).toString()),
                    thema = thema, lagerort = o.text("storage"))
            }
            "MERKLISTE" -> Filterspalten(suchtext(o.text("set_number") ?: "", o.text("name")),
                zustand = o.text("condition") ?: "N")
            "TEILE" -> o.pflicht("part_number")?.let { nr ->
                Filterspalten(suchtext(nr, o.text("part_name"), o.text("bl_part_number")), farbe = o.text("color_name"),
                    kategorie = o.text("category_name"), ersatzteil = (o["is_spare"] as? JsonPrimitive)?.booleanOrNull ?: false)
            }
            "FIGUREN" -> o.pflicht("fig_number")?.let { nr -> Filterspalten(suchtext(nr, o.text("fig_name"))) }
            "MANUELLE_TEILE" -> Filterspalten(suchtext(o.text("part_number") ?: "", o.text("part_name"), o.text("bl_part_number")),
                lagerort = o.text("storage"))
            "MANUELLE_FIGUREN" -> Filterspalten(suchtext(o.text("fig_number") ?: "", o.text("fig_name")))
            "GUTSCHEINE" -> Filterspalten()
            else -> null
        }
    }

    private fun JsonObject.text(feld: String): String? = (this[feld] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.zahl(feld: String): Int? = (this[feld] as? JsonPrimitive)?.intOrNull

    /** A required field of the model: if it is missing, the row could not be read in version 2 either. */
    private fun JsonObject.pflicht(feld: String): String? = text(feld)

    private fun suchtext(vararg felder: String?) = felder.filterNotNull().joinToString("\n").lowercase()
}
