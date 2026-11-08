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
 *
 * ── Woher dieser Test kommt (Nachtrag 135) ──────────────────────────────────
 *
 * `app_theme` ist eine GLOBALE Einstellung des Servers und kam bisher nur mit
 * /settings — also erst NACH der Anmeldung. Anmelde- und
 * Einrichtungsbildschirm erschienen dadurch bei jedem Kaltstart im
 * Standard-Design und sprangen nach dem Anmelden um.
 *
 * Die Webapp hat genau dieses Flackern behoben, in zwei Stufen
 * (public/js/00-theme-boot.js):
 *
 *   1. Sofort der zuletzt bekannte Wert aus dem Speicher — kein Netz, kein
 *      Aufblitzen des falschen Designs.
 *   2. Gleich danach asynchron GET /api/v1/settings/theme. Diese Adresse steht
 *      auf dem Server ABSICHTLICH vor dem Anmelde-Waechter (routes/settings.ts).
 *
 * ── Stufe NULL kam nach (Marcos zweiter Befund) ─────────────────────────────
 *
 * „Beim Starten der App sieht man teilweise das andere Design, insbesondere
 * dann wenn die Internetverbindung schlecht ist."
 *
 * Stufe eins war da — aber nur im DataStore, und der laesst sich ausschliesslich
 * ASYNCHRON lesen. MainActivity.setContent() laeuft sofort; die ersten Bilder
 * entstanden deshalb immer im Vorgabewert, und erst danach traf der gemerkte
 * Wert ein. Bei schlechtem Netz dauert der Kaltstart laenger und das Fenster
 * wird sichtbar.
 *
 * Die Webapp hatte das nie: 00-theme-boot.js ist ein BLOCKIERENDES Skript im
 * <head> und liest localStorage, bevor irgendetwas gezeichnet wird. Das
 * Gegenstueck sind SharedPreferences — synchron lesbar, und genau dafuer
 * benutzt Android sie selbst.
 *
 * Dass der Zustand MIT dem gemerkten Design geboren wird, prüft
 * DarstellungUndVertrauenTest am ausgeführten DarstellungViewModel.
 *
 * Gefunden durch Messen: Ein Vergleich der Server-Adressen beider Clients
 * meldete /v1/settings/theme als eine der Adressen, die nur die Webapp ruft.
 *
 * Stufe null und eins (Spiegel, unbekannte Werte) prüft DesignAblageTest in core-data
 * an der echten GeraeteAblage.
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
 *
 * ── Woher dieser Test kommt (Nachtrag 135) ──────────────────────────────────
 *
 * Aus derselben Messung wie das Design darueber: /v1/admin/cache-clear war
 * eine der Adressen, die nur die Webapp ruft. Die App zeigte die vier
 * Cache-Zahlen (Preise, veraltet, Teilmengen, Katalog) und liess die
 * Gueltigkeitsdauer einstellen — leeren konnte sie nicht. Man sah also, dass
 * tausend Preise veraltet sind, und hatte keine Handhabe.
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
