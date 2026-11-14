package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.AppToken
import ch.brickinventoryapp.vertrag.TOKEN_SCOPE_VOLL
import ch.brickinventoryapp.model.ui.model.GeraetAnsicht

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
