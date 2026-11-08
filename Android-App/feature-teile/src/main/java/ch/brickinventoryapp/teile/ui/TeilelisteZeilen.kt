package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.ui.model.OHNE_FARBE

// Die Zeilen der temporären Teileliste. Eigene Datei ohne Compose, damit die
// Auflösung eines Sets (ui/Teileliste.kt) ohne Oberfläche prüfbar ist.

/** „10294“ heisst „10294-1“ — wie überall, wo eine Setnummer getippt wird. */
internal fun normalisiert(nr: String): String = if (nr.contains("-")) nr.trim() else "${nr.trim()}-1"

data class PlSet(val setNumber: String, val name: String = "")

data class PlPart(
    val partNumber: String,
    val blPartNumber: String? = null,
    val partName: String,
    val colorName: String,
    val colorHex: String?,
    val colorId: Int = OHNE_FARBE,
    val blColorId: Int? = null,
    val quantity: Int,
    val imageUrl: String?,
    val imageLocal: String? = null,
    val isFig: Boolean = false,
    /**
     * Wie viele davon im eigenen Bestand liegen — `null`, solange nicht
     * gefragt wurde.
     * Ausführlich: docs/begruendungen/feature-teile/teile/ui/TeilelisteZeilen.kt.md#vorhanden
     */
    val vorhanden: Int? = null,
)
