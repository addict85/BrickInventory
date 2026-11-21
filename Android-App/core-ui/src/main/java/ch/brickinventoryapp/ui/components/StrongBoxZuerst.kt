package ch.brickinventoryapp.ui.components

import java.security.ProviderException

/**
 * First in the StrongBox chip, otherwise in the TEE: the chip holds the key even against an
 * attack on the main system. Only a missing chip
 * ([android.security.keystore.StrongBoxUnavailableException]) or one that cannot
 * generate the key (some devices report this more generically) falls back to the TEE;
 * both are a ProviderException. Every other error stays an error. The server accepts TEE just like StrongBox.
 */
internal fun <T> strongBoxFirst(erzeuge: (strongBox: Boolean) -> T): T =
    try {
        erzeuge(true)
    } catch (_: ProviderException) {
        erzeuge(false)
    }
