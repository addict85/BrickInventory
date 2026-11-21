package ch.brickinventoryapp.model.domain

/**
 * A signed-in device as the device list shows it. The deadline is already
 * decided: of sliding and fixed deadline the earlier one counts — the day on
 * which the device is locked out.
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
