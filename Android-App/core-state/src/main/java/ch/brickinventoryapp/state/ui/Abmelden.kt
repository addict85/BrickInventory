package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.session.Abmeldevorgang
import ch.brickinventoryapp.data.Abmeldeweg
import ch.brickinventoryapp.data.Abmeldung
import ch.brickinventoryapp.data.SitzungsBereinigung
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import javax.inject.Inject

/**
 * The order of signing out: first the server revokes the token (on a
 * server change that's still the old server), then the data layer cleans up the device,
 * and finally widget, session and Blickfeld clear their state.
 */
class Abmelden @Inject constructor(
    private val cleanup: SitzungsBereinigung,
    private val abmeldehaken: Abmeldehaken,
    private val sitzung: Sitzung,
    private val blickfeld: Scope,
    private val abmeldung: Abmeldung,
) : Abmeldevorgang {
    /** Reports whether the server revokes the token only later (from the queue). */
    override suspend fun ausfuehren(): Abmeldeweg? {
        val weg = if (sitzung.state.value.isLoggedIn) abmeldung.atServer() else null
        cleanup.raeumeAuf()
        // Otherwise the widget would keep showing the signed-out account's numbers.
        fangeAusserAbbruch { abmeldehaken.abgemeldet() }
        sitzung.abgemeldet()
        blickfeld.reset()
        return weg
    }
}
