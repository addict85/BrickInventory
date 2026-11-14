package ch.brickinventoryapp.ui.components

import java.security.ProviderException

/**
 * Erst im StrongBox-Chip, sonst im TEE: Der Chip hält den Schlüssel auch gegen einen
 * Angriff auf das Hauptsystem. Zum TEE führt nur ein fehlender Chip
 * ([android.security.keystore.StrongBoxUnavailableException]) oder einer, der den
 * Schlüssel nicht erzeugen kann (manche Geräte melden das allgemeiner); beides ist eine
 * ProviderException. Jeder andere Fehler bleibt einer. Der Server nimmt TEE wie StrongBox an.
 */
internal fun <T> strongBoxZuerst(erzeuge: (strongBox: Boolean) -> T): T =
    try {
        erzeuge(true)
    } catch (_: ProviderException) {
        erzeuge(false)
    }
