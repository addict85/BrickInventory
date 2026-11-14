package ch.brickinventoryapp.model.ui.model

/**
 * Ein angemeldetes Gerät, wie die Geräteliste es zeigt. Die Frist ist schon
 * entschieden: Von gleitender und fester Frist zählt die frühere — der Tag, an
 * dem das Gerät ausgesperrt wird.
 */

data class GeraetAnsicht(
    val tokenId: String,
    val bezeichnung: String,
    val aktuell: Boolean,
    val angelegt: String?,
    val zuletztBenutzt: String?,
    /** Null heisst unbegrenzt. */
    val laeuftAb: String?,
    val vollerZugriff: Boolean,
    val ipBereich: String?,
)
