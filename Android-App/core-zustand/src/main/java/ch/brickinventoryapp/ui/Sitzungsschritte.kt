package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.Abmeldeweg

/** Abmelden, wie das AppViewModel es auslöst; so läuft dessen Test ohne Context und Bildlader. */
fun interface Abmeldevorgang {
    /** Liefert, ob der Server den Token erst später entwertet; null ohne Anmeldung. */
    suspend fun ausfuehren(): Abmeldeweg?
}

/** Der eine Schritt, den das AppViewModel vom Vorwärmen kennt. */
fun interface Vorwaermung {
    fun anstossen()
}
