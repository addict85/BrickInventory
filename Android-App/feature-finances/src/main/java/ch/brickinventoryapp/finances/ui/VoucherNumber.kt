package ch.brickinventoryapp.finances.ui

import ch.brickinventoryapp.model.domain.isVoucherMask

/**
 * A voucher number meant to be read: first the issuer's separators go,
 * then it is grouped evenly in fours — „1234-5678 9“ would otherwise read „1234 -567 8 9“.
 */
internal fun inGroupsOfFour(number: String): String =
    // The server's mask („…1234“) stays as it is: filtered it would read „1234“
    // and look like a whole, short number.
    if (isVoucherMask(number)) number
    else number.filter { it.isLetterOrDigit() }.chunked(4).joinToString(" ")
