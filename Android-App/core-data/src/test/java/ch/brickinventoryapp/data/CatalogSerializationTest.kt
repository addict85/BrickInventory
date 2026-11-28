package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.CatalogMetaResponse
import ch.brickinventoryapp.contract.CatalogSetDetail
import ch.brickinventoryapp.contract.CatalogSetDetailResponse
import ch.brickinventoryapp.contract.CatalogSetsResponse
import ch.brickinventoryapp.contract.testing.decodeCompleted
import ch.brickinventoryapp.dataapi.catalog.BrickLinkUrls
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Client-side API contract: the catalog models must parse real
 * server responses of the /api/v2/catalog endpoints — including unknown
 * extra fields (the server may extend without breaking the app) and
 * missing required fields, which are refused. The payloads name the fields each test
 * checks; decodeCompleted fills in the other required ones.
 */
class CatalogSerializationTest {

    // Same configuration as AppModule.provideJson()
    @Test
    fun `meta response is parsed`() {
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
        val r = decodeCompleted<CatalogMetaResponse>(payload)
        assertTrue(r.success)
        assertEquals(2, r.themes.size)
        assertEquals("Star Wars › Ultimate Collector Series", r.themes[1].name)
        assertEquals(1949, r.yearMin)
        assertEquals(2027, r.yearMax)
        assertEquals(4, r.yearCounts.first { it.year == 2027 }.n)
    }

    @Test
    fun `sets response is parsed - incl owned flags`() {
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
        val r = decodeCompleted<CatalogSetsResponse>(payload)
        assertEquals(2, r.total)
        assertTrue(r.sets[0].owned)
        assertEquals(2, r.sets[0].ownedQuantity)
        assertNull(r.sets[1].imageUrl)
        assertNull(r.sets[1].themeName)
    }

    @Test
    fun `detail response is parsed`() {
        val payload = """{
            "success": true,
            "set": {"set_number": "6346-1", "name": "Shuttle Launching Crew", "year": 1992,
                    "theme_id": 5, "theme_name": "Town › Launch Command", "num_parts": 154,
                    "image_url": null, "minifigs": 3, "owned": false, "owned_quantity": 0}
        }"""
        val r = decodeCompleted<CatalogSetDetailResponse>(payload)
        assertEquals(3, r.set?.minifigs)
        assertEquals("Town › Launch Command", r.set?.themeName)
    }

    @Test
    fun `unknown extra fields do not break parsing`() {
        // Server extensions (new fields) must not break old app versions
        val payload = """{
            "success": true, "total": 0, "page": 1, "pages": 1, "sets": [],
            "brandneues_feld": {"x": 1}, "noch_eins": [1, 2, 3]
        }"""
        val r = decodeCompleted<CatalogSetsResponse>(payload)
        assertEquals(0, r.total)
    }

    @Test
    fun `a set without its required fields is refused, not shown as not owned`() {
        val payload = """{"success": true, "sets": [{"set_number": "42100-1"}], "total": 1, "page": 1, "page_size": 60}"""
        assertThrows(SerializationException::class.java) { BrickJson.decodeFromString<CatalogSetsResponse>(payload) }
    }

    @Test
    fun `error response is parsed`() {
        val r = decodeCompleted<CatalogSetDetailResponse>(
            """{"success": false, "error": "Set nicht im Katalog gefunden"}"""
        )
        assertEquals(false, r.success)
        assertNull(r.set)
    }
}

class BrickLinkUrlsTest {

    @Test
    fun `purchase URL matches the web app format`() {
        assertEquals(
            "https://www.bricklink.com/v2/catalog/catalogitem.page?S=6346-1#T=S&O={%22iconly%22:0}",
            BrickLinkUrls.setForSale("6346-1")
        )
    }

    @Test
    fun `set number is URL-encoded`() {
        // Hypothetical special characters must not break the URL
        val url = BrickLinkUrls.setForSale("10 30-1")
        assertTrue(url.contains("S=10+30-1") || url.contains("S=10%2030-1"))
    }
}

/**
 * The catalog detail link now comes ready from the server. These tests secure
 * two things: that the field deserializes correctly, and that the local fallback maps the
 * BrickLink item types correctly.
 */
class BrickLinkRefTest {

    @Test
    fun `bricklink field is taken over`() {
        val raw = """{"set_number":"5005358-1","bricklink":{"type":"GEAR","number":"5005358","url":"https://x/","resolved":true}}"""
        val d = decodeCompleted<CatalogSetDetail>(raw)
        assertEquals("GEAR", d.bricklink?.type)
        assertEquals("5005358", d.bricklink?.number)
        assertEquals("https://x/", d.bricklink?.url)
        assertEquals(true, d.bricklink?.resolved)
    }

    @Test
    fun `unlisted item delivers url null`() {
        val raw = """{"set_number":"x-1","bricklink":{"type":"NONE","number":"x-1","url":null,"resolved":true}}"""
        val d = decodeCompleted<CatalogSetDetail>(raw)
        assertEquals("NONE", d.bricklink?.type)
        assertEquals(null, d.bricklink?.url)
    }

    @Test
    fun `fallback URL uses the right parameter per type`() {
        // Set: S= and number WITH variant suffix
        assertTrue(BrickLinkUrls.forSale("75192-1", "SET").contains("?S=75192-1"))
        assertTrue(BrickLinkUrls.forSale("75192-1", "SET").contains("#T=S"))
        // Gear/Book: G= or B=, BrickLink lists them without suffix
        assertTrue(BrickLinkUrls.forSale("5005358", "GEAR").contains("?G=5005358"))
        assertTrue(BrickLinkUrls.forSale("5005358", "GEAR").contains("#T=G"))
        assertTrue(BrickLinkUrls.forSale("ISBN123", "BOOK").contains("?B=ISBN123"))
        // Unknown type falls back to set
        assertTrue(BrickLinkUrls.forSale("123-1", "WAS_AUCH_IMMER").contains("?S="))
    }
}
