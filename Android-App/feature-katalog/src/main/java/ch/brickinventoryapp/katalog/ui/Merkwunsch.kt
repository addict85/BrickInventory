package ch.brickinventoryapp.katalog.ui

import ch.brickinventoryapp.model.fach.Zustand

/** Richtung eines Preisalarms; [wert] ist die Kennung des Servers (PreisalarmRequest). */
enum class Alarmrichtung(val wert: String) { UNTER("unter"), UEBER("ueber") }

/**
 * „Auf die Merkliste“ aus dem Katalog-Detail. Die Schwelle bleibt Text: Leer heisst
 * „kein Alarm“, nicht „Schwelle 0“, und umgewandelt wird an der einen Stelle, die es
 * kann (Alarmeingabe). [konto] ist das Zielkonto, null ohne Haushalt.
 */
data class Merkwunsch(
    val setNumber: String,
    val zustand: Zustand,
    val richtung: Alarmrichtung,
    val schwelleRoh: String,
    val konto: Int?,
)
