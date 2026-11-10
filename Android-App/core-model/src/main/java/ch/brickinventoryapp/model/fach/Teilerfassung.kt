package ch.brickinventoryapp.model.fach

import ch.brickinventoryapp.model.data.model.KEINE_FARBE

/**
 * Ein Teil, wie es der Erfassungsdialog einsammelt. Benannte Felder statt neun Werten
 * nach ihrer Stellung: Farbname und Farbcode sind beide `String?` und liessen sich
 * unbemerkt vertauschen. [KEINE_FARBE] heisst wie am Server „ohne Farbe“, 0 wäre Schwarz.
 */
data class Teilerfassung(
    val nummer: String,
    val farbId: Int = KEINE_FARBE,
    val farbname: String? = null,
    val farbHex: String? = null,
    val menge: Int = 1,
    val stueckpreis: Double? = null,
    val zustand: Zustand? = null,
    val besitzer: Int? = null,
    val lagerort: String? = null,
)

/** Eine Minifigur, wie es der Erfassungsdialog einsammelt; siehe [Teilerfassung]. */
data class Figurenerfassung(
    val nummer: String,
    val blNummer: String? = null,
    val menge: Int = 1,
    val stueckpreis: Double? = null,
    val zustand: Zustand? = null,
    val besitzer: Int? = null,
    val lagerort: String? = null,
)
