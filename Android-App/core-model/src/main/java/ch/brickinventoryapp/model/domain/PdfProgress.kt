package ch.brickinventoryapp.model.domain

/** Was ein laufender PDF-Export gerade tut. */

enum class PdfStep { STARTET, IMAGES_LOAD, CREATED, COMPLETION, DOWNLOAD }

/**
 * Der Stand eines laufenden PDF-Exports als Fachwert; den Satz dazu bildet die
 * Oberfläche in ihrer Sprache. [restSeconds] gibt es nur beim Erstellen, aus der
 * Schätzung des Servers; höchstens 0 heisst „gleich fertig“.
 */
data class PdfProgress(val schritt: PdfStep, val restSeconds: Int? = null)
