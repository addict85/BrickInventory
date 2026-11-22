package ch.brickinventoryapp.model.domain

import java.time.Instant

/**
 * A signed-in device as the device list shows it. The deadline is already
 * decided: of sliding and fixed deadline the earlier one counts — the day on
 * which the device is locked out.
 */

data class DeviceView(
    val tokenId: String,
    val name: String,
    val current: Boolean,
    val created: String?,
    val lastlyUsed: String?,
    /** Null means unlimited. */
    val expiresAt: Instant?,
    val fullAccess: Boolean,
    val ipArea: String?,
)
