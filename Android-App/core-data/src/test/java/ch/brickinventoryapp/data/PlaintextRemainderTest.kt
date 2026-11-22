package ch.brickinventoryapp.data

import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.mutablePreferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * After the update the app clears away the permissions of the old cleartext permission and the
 * filters of earlier versions and leaves everything else standing.
 *
 * Counter-checks: „klartext_netze“ taken out of the list → red (the key stayed);
 * „lager_“ taken out of FILTER → red “the filters of earlier versions go …”
 * (kotlinc locally; counter-checks/filter-bleiben-im-klartext.patch).
 */
class PlaintextRemainderTest {

    @Test
    fun `the cleartext permissions go, the address stays`() {
        val prefs = mutablePreferencesOf(
            stringSetPreferencesKey("klartext_hosts") to setOf("brick.example.org"),
            stringSetPreferencesKey("klartext_netze") to setOf("http://nas:3000|a1b2"),
            booleanPreferencesKey("klartext_alt_uebernommen") to true,
            stringPreferencesKey("server_url") to "https://brick.example.org",
        )
        PlaintextRemainder.remove(prefs)
        assertEquals(setOf("server_url"), prefs.asMap().keys.map { it.name }.toSet())
    }

    @Test
    fun `the filters of earlier versions go, a similar name stays`() {
        val prefs = mutablePreferencesOf(
            stringPreferencesKey("scope_sets") to "anna",
            stringPreferencesKey("lager_parts") to "Keller",
            stringPreferencesKey("lager_sets") to "Dachboden",
            stringPreferencesKey("server_url_geheim") to "x",
            stringPreferencesKey("currency") to "CHF",
        )
        PlaintextRemainder.remove(prefs)
        assertEquals(setOf("server_url_geheim", "currency"), prefs.asMap().keys.map { it.name }.toSet())
    }
}
