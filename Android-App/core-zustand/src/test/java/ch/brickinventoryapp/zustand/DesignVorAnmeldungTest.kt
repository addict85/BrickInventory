package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.VerwaltungRepository
import ch.brickinventoryapp.testing.mitRepo

/**
 * Das Design des Servers steht schon vor der Anmeldung fest.
 */
class DesignVorAnmeldungTest {

    /**
     * Die Abfrage gegen einen Testserver; das Einbinden ins AppViewModel führt
     * AppViewModelTest aus. Gegenprobe: `@GET("api/v1/settings/theme")`
     * auf "…/design" → rot.
     */
    @Test
    fun `Stufe zwei - die oeffentliche Adresse wird gerufen`() {
        mitRepo(::KontoRepository) { pfade, admin ->
            runBlocking { admin.getAppTheme() }
            assertEquals(listOf("GET /api/v1/settings/theme"), pfade.anfragen.toList())
        }
    }
}

/**
 * Die Ueberwachung kann den Cache nicht nur ANSEHEN.
 */
class CacheLeerenTest {

    /**
     * Gegen einen Testserver. Gegenprobe: in
     * VerwaltungRepository.clearCache immer `emptyMap()` → rot.
     */
    @Test
    fun `die App kennt die Adresse und beide Umfaenge`() = mitRepo(::VerwaltungRepository) { pfade, admin ->
        runBlocking {
            admin.clearCache(alles = false)
            admin.clearCache(alles = true)
        }
        assertEquals(listOf("POST /api/v1/admin/cache-clear", "POST /api/v1/admin/cache-clear"), pfade.anfragen.toList())
        assertEquals("Der Umfang (nur Preise / alles) wird nicht unterschieden",
            listOf("{}", """{"all":true}"""), pfade.koerper.toList())
    }
}
