package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.CatalogMetaResponse
import ch.brickinventoryapp.data.model.CatalogSetDetail
import ch.brickinventoryapp.data.model.CatalogSetDetailResponse
import ch.brickinventoryapp.data.model.CatalogSetsResponse
import ch.brickinventoryapp.util.BrickLinkUrls
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Client-seitiger API-Vertrag: Die Katalog-Modelle müssen echte
 * Server-Antworten der /api/v1/catalog-Endpunkte parsen — inklusive unbekannter
 * Zusatzfelder (Server darf erweitern, ohne die App zu brechen) und
 * fehlender optionaler Felder. Die JSON-Payloads entsprechen dem Format,
 * das der Integrationstest des Servers (test/catalog-api.test.js im
 * Manager-Repo) verifiziert.
 */
class CatalogSerializationTest {

    // Gleiche Konfiguration wie AppModule.provideJson()
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
        coerceInputValues = true
    }

    @Test
    fun `meta-Antwort wird geparst`() {
        val payload = """{
            "success": true,
            "themes": [
                {"id": 1, "name": "Star Wars", "set_count": 850},
                {"id": 2, "name": "Star Wars › Ultimate Collector Series", "set_count": 40}
            ],
            "year_min": 1949,
            "year_max": 2027,
            "year_counts": [{"year": 2026, "n": 812}, {"year": 2027, "n": 4}]
        }"""
        val r = json.decodeFromString<CatalogMetaResponse>(payload)
        assertTrue(r.success)
        assertEquals(2, r.themes.size)
        assertEquals("Star Wars › Ultimate Collector Series", r.themes[1].name)
        assertEquals(1949, r.yearMin)
        assertEquals(2027, r.yearMax)
        assertEquals(4, r.yearCounts.first { it.year == 2027 }.n)
    }

    @Test
    fun `sets-Antwort wird geparst - inkl owned-Flags`() {
        val payload = """{
            "success": true, "total": 2, "page": 1, "pages": 1,
            "sets": [
                {"set_number": "75192-1", "name": "Millennium Falcon", "year": 2017,
                 "theme_id": 2, "theme_name": "Star Wars › UCS", "num_parts": 7541,
                 "image_url": "https://cdn.rebrickable.com/x.jpg",
                 "owned": true, "owned_quantity": 2},
                {"set_number": "6346-1", "name": "Shuttle Launching Crew", "year": 1992,
                 "theme_id": 5, "theme_name": null, "num_parts": 154,
                 "image_url": null, "owned": false, "owned_quantity": 0}
            ]
        }"""
        val r = json.decodeFromString<CatalogSetsResponse>(payload)
        assertEquals(2, r.total)
        assertTrue(r.sets[0].owned)
        assertEquals(2, r.sets[0].ownedQuantity)
        assertNull(r.sets[1].imageUrl)
        assertNull(r.sets[1].themeName)
    }

    @Test
    fun `detail-Antwort wird geparst`() {
        val payload = """{
            "success": true,
            "set": {"set_number": "6346-1", "name": "Shuttle Launching Crew", "year": 1992,
                    "theme_id": 5, "theme_name": "Town › Launch Command", "num_parts": 154,
                    "image_url": null, "minifigs": 3, "owned": false, "owned_quantity": 0}
        }"""
        val r = json.decodeFromString<CatalogSetDetailResponse>(payload)
        assertEquals(3, r.set?.minifigs)
        assertEquals("Town › Launch Command", r.set?.themeName)
    }

    @Test
    fun `unbekannte Zusatzfelder brechen das Parsen nicht`() {
        // Server-Erweiterungen (neue Felder) dürfen alte App-Versionen nicht brechen
        val payload = """{
            "success": true, "total": 0, "page": 1, "pages": 1, "sets": [],
            "brandneues_feld": {"x": 1}, "noch_eins": [1, 2, 3]
        }"""
        val r = json.decodeFromString<CatalogSetsResponse>(payload)
        assertEquals(0, r.total)
    }

    @Test
    fun `fehlende optionale Felder fallen auf Defaults zurueck`() {
        val payload = """{"success": true, "sets": [{"set_number": "42100-1"}], "total": 1}"""
        val r = json.decodeFromString<CatalogSetsResponse>(payload)
        val s = r.sets.single()
        assertEquals("42100-1", s.setNumber)
        assertNull(s.name)
        assertNull(s.year)
        assertEquals(false, s.owned)
        assertEquals(0, s.ownedQuantity)
    }

    @Test
    fun `fehler-Antwort wird geparst`() {
        val r = json.decodeFromString<CatalogSetDetailResponse>(
            """{"success": false, "error": "Set nicht im Katalog gefunden"}"""
        )
        assertEquals(false, r.success)
        assertNull(r.set)
        assertEquals("Set nicht im Katalog gefunden", r.error)
    }
}

class BrickLinkUrlsTest {

    @Test
    fun `kauf-URL entspricht dem Webapp-Format`() {
        assertEquals(
            "https://www.bricklink.com/v2/catalog/catalogitem.page?S=6346-1#T=S&O={%22iconly%22:0}",
            BrickLinkUrls.setForSale("6346-1")
        )
    }

    @Test
    fun `setnummer wird URL-encodiert`() {
        // Hypothetische Sonderzeichen dürfen die URL nicht zerbrechen
        val url = BrickLinkUrls.setForSale("10 30-1")
        assertTrue(url.contains("S=10+30-1") || url.contains("S=10%2030-1"))
    }
}

/**
 * Der Katalog-Detail-Link kommt jetzt fertig vom Server. Diese Tests sichern
 * zweierlei: dass das neue Feld korrekt deserialisiert (auch wenn es fehlt —
 * ältere Server liefern es nicht), und dass der lokale Fallback die
 * BrickLink-Item-Typen richtig abbildet.
 */
class BrickLinkRefTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `bricklink-Feld wird uebernommen`() {
        val raw = """{"set_number":"5005358-1","bricklink":{"type":"GEAR","number":"5005358","url":"https://x/","resolved":true}}"""
        val d = json.decodeFromString<CatalogSetDetail>(raw)
        assertEquals("GEAR", d.bricklink?.type)
        assertEquals("5005358", d.bricklink?.number)
        assertEquals("https://x/", d.bricklink?.url)
        assertEquals(true, d.bricklink?.resolved)
    }

    @Test
    fun `fehlendes bricklink-Feld bleibt null (Altserver)`() {
        val d = json.decodeFromString<CatalogSetDetail>("""{"set_number":"75192-1"}""")
        assertEquals(null, d.bricklink)
    }

    @Test
    fun `nicht gelisteter Artikel liefert url null`() {
        val raw = """{"set_number":"x-1","bricklink":{"type":"NONE","number":"x-1","url":null,"resolved":true}}"""
        val d = json.decodeFromString<CatalogSetDetail>(raw)
        assertEquals("NONE", d.bricklink?.type)
        assertEquals(null, d.bricklink?.url)
    }

    @Test
    fun `Fallback-URL nutzt je Typ den richtigen Parameter`() {
        // Set: S= und Nummer MIT Variantensuffix
        assertTrue(BrickLinkUrls.forSale("75192-1", "SET").contains("?S=75192-1"))
        assertTrue(BrickLinkUrls.forSale("75192-1", "SET").contains("#T=S"))
        // Gear/Book: G= bzw. B=, BrickLink führt sie ohne Suffix
        assertTrue(BrickLinkUrls.forSale("5005358", "GEAR").contains("?G=5005358"))
        assertTrue(BrickLinkUrls.forSale("5005358", "GEAR").contains("#T=G"))
        assertTrue(BrickLinkUrls.forSale("ISBN123", "BOOK").contains("?B=ISBN123"))
        // Unbekannter Typ fällt auf Set zurück
        assertTrue(BrickLinkUrls.forSale("123-1", "WAS_AUCH_IMMER").contains("?S="))
    }
}
