package ch.brickinventoryapp.data

import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.mutablePreferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Nach dem Update räumt die App die Freigaben der alten Klartext-Erlaubnis und die
 * Filter früherer Fassungen weg und lässt alles andere stehen.
 *
 * Gegenproben: „klartext_netze“ aus der Liste genommen → rot (der Schlüssel blieb stehen);
 * „lager_“ aus FILTER genommen → rot „die Filter frueherer Fassungen gehen …“
 * (kotlinc lokal; gegenproben/filter-bleiben-im-klartext.patch).
 */
class KlartextResteTest {

    @Test
    fun `die Klartext-Freigaben gehen, die Adresse bleibt`() {
        val prefs = mutablePreferencesOf(
            stringSetPreferencesKey("klartext_hosts") to setOf("brick.example.org"),
            stringSetPreferencesKey("klartext_netze") to setOf("http://nas:3000|a1b2"),
            booleanPreferencesKey("klartext_alt_uebernommen") to true,
            stringPreferencesKey("server_url") to "https://brick.example.org",
        )
        KlartextReste.entferne(prefs)
        assertEquals(setOf("server_url"), prefs.asMap().keys.map { it.name }.toSet())
    }

    @Test
    fun `die Filter frueherer Fassungen gehen, ein aehnlicher Name bleibt`() {
        val prefs = mutablePreferencesOf(
            stringPreferencesKey("scope_sets") to "anna",
            stringPreferencesKey("lager_parts") to "Keller",
            stringPreferencesKey("lager_sets") to "Dachboden",
            stringPreferencesKey("server_url_geheim") to "x",
            stringPreferencesKey("currency") to "CHF",
        )
        KlartextReste.entferne(prefs)
        assertEquals(setOf("server_url_geheim", "currency"), prefs.asMap().keys.map { it.name }.toSet())
    }
}
