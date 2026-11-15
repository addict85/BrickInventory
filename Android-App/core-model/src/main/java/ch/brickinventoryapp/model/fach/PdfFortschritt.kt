package ch.brickinventoryapp.model.fach

/** Was ein laufender PDF-Export gerade tut. */

enum class PdfSchritt { STARTET, BILDER_LADEN, ERSTELLT, ABSCHLUSS, HERUNTERLADEN }

/**
 * Der Stand eines laufenden PDF-Exports als Fachwert; den Satz dazu bildet die
 * Oberfläche in ihrer Sprache. [restSekunden] gibt es nur beim Erstellen, aus der
 * Schätzung des Servers; höchstens 0 heisst „gleich fertig“.
 */
data class PdfFortschritt(val schritt: PdfSchritt, val restSekunden: Int? = null)
