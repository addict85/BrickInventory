package ch.brickinventoryapp.model.domain

/** Nummer und PIN im Klartext für die Anzeige; der Bildschirm kennt das Server-Modell nicht. */
data class PlaintextView(val id: Int, val number: String, val pin: String?)

/** Die Maske des Servers für die PIN, für die Anzeige. */
const val PIN_MASK_DISPLAY = VOUCHER_PIN_MASK

fun isMaskedNumber(nummer: String): Boolean = isVoucherMask(nummer)
