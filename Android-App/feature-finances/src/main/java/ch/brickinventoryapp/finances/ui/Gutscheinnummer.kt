package ch.brickinventoryapp.finances.ui

import ch.brickinventoryapp.model.domain.isVoucherMask

/**
 * Eine Gutscheinnummer zum Ablesen: erst die Trennzeichen des Herausgebers weg,
 * dann gleichmässig in Vierer — „1234-5678 9“ hiesse sonst „1234 -567 8 9“.
 */
fun inGroupsOfFour(nummer: String): String =
    // Die Maske des Servers („…1234“) bleibt, wie sie ist: gefiltert hiesse sie „1234“
    // und sähe aus wie eine ganze, kurze Nummer.
    if (isVoucherMask(nummer)) nummer
    else nummer.filter { it.isLetterOrDigit() }.chunked(4).joinToString(" ")
