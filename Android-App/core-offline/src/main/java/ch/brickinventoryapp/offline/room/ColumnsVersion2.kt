package ch.brickinventoryapp.offline.room

import ch.brickinventoryapp.offline.FilterColumns
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
internal object ColumnsVersion2 {

    fun from(kind: String, content: String): FilterColumns? {
        val o = runCatching { Json.parseToJsonElement(content) as? JsonObject }.getOrNull() ?: return null
        return when (kind) {
            "SETS" -> o.required("set_number")?.let { nr ->
                val theme = o.text("theme")
                FilterColumns(searchText(nr, o.text("name"), theme.orEmpty(), (o.number("year") ?: 0).toString()),
                    theme = theme, storageLocation = o.text("storage"))
            }
            "MERKLISTE" -> FilterColumns(searchText(o.text("set_number") ?: "", o.text("name")),
                condition = o.text("condition") ?: "N")
            "TEILE" -> o.required("part_number")?.let { nr ->
                FilterColumns(searchText(nr, o.text("part_name"), o.text("bl_part_number")), color = o.text("color_name"),
                    category = o.text("category_name"), sparePart = (o["is_spare"] as? JsonPrimitive)?.booleanOrNull ?: false)
            }
            "FIGUREN" -> o.required("fig_number")?.let { nr -> FilterColumns(searchText(nr, o.text("fig_name"))) }
            "MANUELLE_TEILE" -> FilterColumns(searchText(o.text("part_number") ?: "", o.text("part_name"), o.text("bl_part_number")),
                storageLocation = o.text("storage"))
            "MANUELLE_FIGUREN" -> FilterColumns(searchText(o.text("fig_number") ?: "", o.text("fig_name")))
            "GUTSCHEINE" -> FilterColumns()
            else -> null
        }
    }

    private fun JsonObject.text(field: String): String? = (this[field] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.number(field: String): Int? = (this[field] as? JsonPrimitive)?.intOrNull

    /** A required field of the model: if it is missing, the row could not be read in version 2 either. */
    private fun JsonObject.required(field: String): String? = text(field)

    private fun searchText(vararg fields: String?) = fields.filterNotNull().joinToString("\n").lowercase()
}
