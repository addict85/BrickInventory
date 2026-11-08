package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.data.Abmeldeweg
import ch.brickinventoryapp.data.Abmeldung
import ch.brickinventoryapp.data.SitzungsBereinigung
import ch.brickinventoryapp.data.util.fangeAusserAbbruch
import javax.inject.Inject

/**
 * Die Reihenfolge des Abmeldens: Zuerst entwertet der Server den Token (beim
 * Serverwechsel ist das noch der alte Server), dann räumt die Datenschicht das Gerät
 * auf, zuletzt leeren Widget, Sitzung und Blickfeld ihren Zustand.
 */
class Abmelden @Inject constructor(
    private val bereinigung: SitzungsBereinigung,
    private val abmeldehaken: Abmeldehaken,
    private val sitzung: Sitzung,
    private val blickfeld: Blickfeld,
    private val abmeldung: Abmeldung,
) : Abmeldevorgang {
    /** Liefert, ob der Server den Token erst später entwertet (aus der Warteschlange). */
    override suspend fun ausfuehren(): Abmeldeweg? {
        val weg = if (sitzung.state.value.isLoggedIn) abmeldung.amServer() else null
        bereinigung.raeumeAuf()
        // Das Widget zeigt sonst die Zahlen des abgemeldeten Kontos weiter.
        fangeAusserAbbruch { abmeldehaken.abgemeldet() }
        sitzung.abgemeldet()
        blickfeld.zuruecksetzen()
        return weg
    }
}
