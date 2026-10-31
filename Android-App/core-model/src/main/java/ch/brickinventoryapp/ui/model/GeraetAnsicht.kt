package ch.brickinventoryapp.ui.model

import ch.brickinventoryapp.data.model.AppToken
import ch.brickinventoryapp.data.model.TOKEN_SCOPE_VOLL

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

fun AppToken.alsGeraet(): GeraetAnsicht = GeraetAnsicht(
    tokenId = tokenId,
    bezeichnung = label?.takeIf { it.isNotBlank() } ?: "—",
    aktuell = aktuell,
    angelegt = createdAt,
    zuletztBenutzt = lastUsed,
    // ISO-Zeitstempel lassen sich als Text vergleichen.
    laeuftAb = listOfNotNull(expiresAt.takeUnless { neverExpires }, hardExpiresAt).minOrNull(),
    vollerZugriff = scope == TOKEN_SCOPE_VOLL,
    ipBereich = ipBereich?.takeIf { it.isNotBlank() },
)
