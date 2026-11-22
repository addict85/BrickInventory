package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.AppToken
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_FULL
import ch.brickinventoryapp.model.domain.DeviceView
import ch.brickinventoryapp.model.util.parseInstant

fun AppToken.asDevice(): DeviceView = DeviceView(
    tokenId = tokenId,
    name = label?.takeIf { it.isNotBlank() } ?: "—",
    current = aktuell,
    created = createdAt,
    lastlyUsed = lastUsed,
    // Of the sliding and the fixed deadline the earlier one counts.
    expiresAt = listOfNotNull(expiresAt.takeUnless { neverExpires }, hardExpiresAt).mapNotNull(::parseInstant).minOrNull(),
    fullAccess = scope == TOKEN_SCOPE_FULL,
    ipArea = ipRange?.takeIf { it.isNotBlank() },
)
