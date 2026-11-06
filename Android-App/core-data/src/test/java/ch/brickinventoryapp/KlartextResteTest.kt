package ch.brickinventoryapp

import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.mutablePreferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import ch.brickinventoryapp.data.KlartextReste
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Nach dem Update räumt die App die Freigaben der alten Klartext-Erlaubnis weg
 * und lässt alles andere stehen.
 *
 * Gegenprobe: „klartext_netze“ aus der Liste genommen →
 * rot (der Schlüssel blieb stehen).
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
}
