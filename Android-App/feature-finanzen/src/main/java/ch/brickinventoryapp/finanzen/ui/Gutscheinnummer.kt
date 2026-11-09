package ch.brickinventoryapp.finanzen.ui

import ch.brickinventoryapp.model.data.model.istGutscheinMaske

/**
 * Eine Gutscheinnummer zum Ablesen: erst die Trennzeichen des Herausgebers weg,
 * dann gleichmässig in Vierer — „1234-5678 9“ hiesse sonst „1234 -567 8 9“.
 */
fun inVierergruppen(nummer: String): String =
    // Die Maske des Servers („…1234“) bleibt, wie sie ist: gefiltert hiesse sie „1234“
    // und sähe aus wie eine ganze, kurze Nummer.
    if (istGutscheinMaske(nummer)) nummer
    else nummer.filter { it.isLetterOrDigit() }.chunked(4).joinToString(" ")
