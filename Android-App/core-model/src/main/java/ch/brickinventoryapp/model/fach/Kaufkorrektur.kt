package ch.brickinventoryapp.model.fach

import java.time.LocalDate

/** Was an einem Kauf geändert wird; null heisst unverändert. [besitzer] verschiebt den Kauf in ein anderes Konto. */
data class Kaufkorrektur(
    val preis: Geld? = null,
    val zustand: Zustand? = null,
    val menge: Int? = null,
    val datum: LocalDate? = null,
    val besitzer: Int? = null,
)

/**
 * Was eine Kaufänderung bewirkt hat: [zusammenfassung], wenn der Server die neue Summe des
 * Sets mitschickte und die Ablage sie übernahm; [teile] und [figuren] wanderten mit.
 */
data class Kaufaenderung(val zusammenfassung: Boolean = false, val teile: Int = 0, val figuren: Int = 0)
