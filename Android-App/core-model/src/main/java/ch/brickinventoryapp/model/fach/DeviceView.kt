package ch.brickinventoryapp.model.fach

/**
 * Ein angemeldetes Gerät, wie die Geräteliste es zeigt. Die Frist ist schon
 * entschieden: Von gleitender und fester Frist zählt die frühere — der Tag, an
 * dem das Gerät ausgesperrt wird.
 */

data class DeviceView(
    val tokenId: String,
    val bezeichnung: String,
    val aktuell: Boolean,
    val angelegt: String?,
    val lastlyUsed: String?,
    /** Null heisst unbegrenzt. */
    val runningAb: String?,
    val vollerZugriff: Boolean,
    val ipArea: String?,
)
