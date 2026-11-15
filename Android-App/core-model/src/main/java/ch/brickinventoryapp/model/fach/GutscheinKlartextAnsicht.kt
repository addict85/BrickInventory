package ch.brickinventoryapp.model.fach

/** Nummer und PIN im Klartext für die Anzeige; der Bildschirm kennt das Server-Modell nicht. */
data class KlartextAnsicht(val id: Int, val number: String, val pin: String?)

/** Die Maske des Servers für die PIN, für die Anzeige. */
const val PIN_MASKE_ANZEIGE = GUTSCHEIN_PIN_MASKE

fun istMaskierteNummer(nummer: String): Boolean = istGutscheinMaske(nummer)
