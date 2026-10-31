package ch.brickinventoryapp.ui.theme



/**
 * Gilt „dunkel nach System"? Ohne gespeicherte Wahl ja — eine App, die nachts
 * hell bleibt, obwohl das Telefon dunkel ist, wirkt kaputt. Wer früher
 * ausdrücklich „Design des Servers" gewählt hat, behält das.
 */
fun dunkelNachSystemGilt(gespeichert: Boolean?): Boolean = gespeichert ?: true
