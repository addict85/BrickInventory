package ch.brickinventoryapp.model.domain

// Values the server defines and that domain and display types need too; the
// response types themselves live in core-contract, which knows core-model, not the other way round.

/** This is how an existing PIN stands in every voucher response; PUT takes it as „unchanged“. */

const val VOUCHER_PIN_MASK = "•••"

/** Whether [nummer] is the server's mask („…1234“) and not the card number. */
fun isVoucherMask(nummer: String): Boolean = nummer.startsWith("…")

/**
 * „No color“ as at Rebrickable ([No Color/Any Color]) and on the server
 * (src/infra/validate.ts). 0 is black: whoever sends 0 for „none“ turns
 * a part without color information into a black one.
 */
const val KEINE_FARBE = 9999
