package ch.brickinventoryapp.ui.theme

/**
 * Das Design, das gezeichnet wird: das des Servers — ausser das Gerät will
 * „dunkel nach System" und das System ist dunkel. Werkbank ist das dunkle
 * Design; ein zweites Dunkel-Schema daneben waere ein siebtes mit eigener Pflege.
 */
fun wirksamesDesign(design: String, dunkelNachSystem: Boolean, systemDunkel: Boolean): String =
    if (dunkelNachSystem && systemDunkel) "werkbank" else design

/**
 * Gilt „dunkel nach System"? Ohne gespeicherte Wahl ja — eine App, die nachts
 * hell bleibt, obwohl das Telefon dunkel ist, wirkt kaputt. Wer früher
 * ausdrücklich „Design des Servers" gewählt hat, behält das.
 */
fun dunkelNachSystemGilt(gespeichert: Boolean?): Boolean = gespeichert ?: true
