package ch.brickinventoryapp.model.domain

import java.time.LocalDate

/** What is changed on a purchase; null means unchanged. [besitzer] moves the purchase into another account. */
data class Kaufkorrektur(
    val preis: Geld? = null,
    val zustand: Zustand? = null,
    val menge: Int? = null,
    val datum: LocalDate? = null,
    val besitzer: Int? = null,
)

/**
 * What a purchase change caused: [zusammenfassung] if the server sent along the new total of the
 * set and the store took it over; [teile] and [figuren] moved along.
 */
data class Kaufaenderung(val zusammenfassung: Boolean = false, val teile: Int = 0, val figuren: Int = 0)
