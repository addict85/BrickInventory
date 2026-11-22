package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.AppToken
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_FULL
import ch.brickinventoryapp.model.domain.DeviceView

fun AppToken.asDevice(): DeviceView = DeviceView(
    tokenId = tokenId,
    bezeichnung = label?.takeIf { it.isNotBlank() } ?: "—",
    aktuell = aktuell,
    angelegt = createdAt,
    lastlyUsed = lastUsed,
    // ISO timestamps can be compared as text.
    runningAb = listOfNotNull(expiresAt.takeUnless { neverExpires }, hardExpiresAt).minOrNull(),
    vollerZugriff = scope == TOKEN_SCOPE_FULL,
    ipArea = ipRange?.takeIf { it.isNotBlank() },
)
