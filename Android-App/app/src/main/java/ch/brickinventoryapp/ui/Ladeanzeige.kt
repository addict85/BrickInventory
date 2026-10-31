package ch.brickinventoryapp.ui

/**
 * Was ein Bildschirm mit geladenem Inhalt zeigt. Ein Ladefehler, eine leere
 * Sammlung und eine Suche ohne Treffer verlangen Verschiedenes: „Erneut
 * versuchen“, „etwas erfassen“, „Filter lockern“. Vorher sah ein Fehler in
 * Merkliste und Finanzen aus wie eine leere Liste.
 */
enum class Ladeanzeige { LISTE, LAEDT, FEHLER, KEINE_TREFFER, LEER }

/**
 * Geladener Inhalt geht vor: Ein gescheitertes Neuladen lässt die alte Liste
 * stehen (die Meldung kommt dann als Snackbar). Erst ohne Inhalt entscheidet,
 * ob noch geladen wird, ob es scheiterte, und ob ein Filter schuld ist.
 */
fun ladeanzeige(hatInhalt: Boolean, laedt: Boolean, fehler: String?, gefiltert: Boolean): Ladeanzeige = when {
    hatInhalt -> Ladeanzeige.LISTE
    laedt -> Ladeanzeige.LAEDT
    fehler != null -> Ladeanzeige.FEHLER
    gefiltert -> Ladeanzeige.KEINE_TREFFER
    else -> Ladeanzeige.LEER
}
