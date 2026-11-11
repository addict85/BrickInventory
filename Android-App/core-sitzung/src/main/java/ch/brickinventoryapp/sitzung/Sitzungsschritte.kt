package ch.brickinventoryapp.sitzung

import ch.brickinventoryapp.data.Abmeldeweg

/** Abmelden, wie der SitzungsDienst es auslöst; so läuft dessen Test ohne Context und Bildlader. */
fun interface Abmeldevorgang {
    /** Liefert, ob der Server den Token erst später entwertet; null ohne Anmeldung. */
    suspend fun ausfuehren(): Abmeldeweg?
}

/** Der eine Schritt, den der SitzungsDienst vom Vorwärmen kennt. */
fun interface Vorwaermung {
    fun anstossen()
}

/**
 * Was der SitzungsDienst nach einer Anmeldung nachlädt. Das Blickfeld, das diese
 * Listen hält, liegt im Zustand darüber (core-zustand); die Sitzung kennt nur diese
 * vier Schritte, sonst hinge sie an den Filtern der Bereiche.
 */
interface Filterquelle {
    suspend fun ladeFilter()
    suspend fun ladeMitglieder()
    suspend fun ladeLagerorte()
    suspend fun ladeEigeneLagerorte()
}
