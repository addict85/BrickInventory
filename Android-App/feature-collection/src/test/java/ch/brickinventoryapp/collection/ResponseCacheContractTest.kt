package ch.brickinventoryapp.collection

import ch.brickinventoryapp.contract.FigValuationItem
import ch.brickinventoryapp.contract.Minifig
import ch.brickinventoryapp.contract.MinifigsResponse
import ch.brickinventoryapp.contract.SetsResponse
import ch.brickinventoryapp.contract.StatsResponse
import ch.brickinventoryapp.contract.ValuationSet
import ch.brickinventoryapp.testing.Sources
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.io.File

/**
 * The server's answers pass through serialization without loss; how they lie in the
 * store is checked by StoreShapeTest and StoreVersionTest with their own row form.
 */
class ResponseCacheContractTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `SetsResponse survives the round trip`() {
        val raw = """{"success":true,"total":2,"sets":[
            {"set_number":"75192-1","name":"Falcon","year":2017,"quantity":2,"condition":"N",
             "instructions":[{"url":"https://x/y.pdf","description":"Heft 1"}]},
            {"set_number":"10290-1","name":"Pickup","quantity":1}]}"""
        val decoded = json.decodeFromString(SetsResponse.serializer(), raw)
        val round = json.decodeFromString(SetsResponse.serializer(),
            json.encodeToString(SetsResponse.serializer(), decoded))
        assertEquals(decoded.sets.size, round.sets.size)
        assertEquals("75192-1", round.sets[0].setNumber)
        assertEquals("Falcon", round.sets[0].name)
        // Nested lists are the point at which a relational
        // intermediate layer would have needed a TypeConverter.
        assertEquals(1, round.sets[0].instructions.size)
        assertEquals(2, round.sets[0].quantity)
    }

    @Test
    fun `MinifigsResponse survives the round trip`() {
        val raw = """{"success":true,"total":1,"figs":[
            {"fig_number":"sw0001","fig_name":"Luke","quantity":3,"source":"set"}]}"""
        val decoded = json.decodeFromString(MinifigsResponse.serializer(), raw)
        val round = json.decodeFromString(MinifigsResponse.serializer(),
            json.encodeToString(MinifigsResponse.serializer(), decoded))
        assertEquals(1, round.figs.size)
        assertEquals("sw0001", round.figs[0].figNumber)
        assertEquals(3, round.figs[0].quantity)
    }

    @Test
    fun `StatsResponse survives the round trip`() {
        val raw = """{"success":true,"stats":{"total_sets":380,"total_quantity":400,"total_pieces":243700,"total_instructions":12,"total_parts":0,"total_minifigs":9}}"""
        val decoded = json.decodeFromString(StatsResponse.serializer(), raw)
        val round = json.decodeFromString(StatsResponse.serializer(),
            json.encodeToString(StatsResponse.serializer(), decoded))
        assertNotNull(round.stats)
    }

    @Test
    fun `unknown fields do not break the cache`() {
        // The server may extend its answer without an old
        // cache entry becoming unreadable.
        val raw = """{"success":true,"sets":[{"set_number":"1-1","neues_feld":42}],"noch_eins":"x"}"""
        val decoded = json.decodeFromString(SetsResponse.serializer(), raw)
        assertEquals(1, decoded.sets.size)
    }
}

/**
 * Price fields of the finance answer.
 *
 * Since the server-side change the market price is `avg_price`, not the
 * quantity-weighted average — that lies systematically below it and was the reason
 * why the app showed too low a value in the finances tab and in the detail dialog.
 * On top of that the server now also delivers the quantity-weighted purchase price.
 */
class ValuationPriceFieldsTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `total_avg and purchase_price are read`() {
        val raw = """{"set_number":"10290-1","quantity":2,
            "avg_price":148.72,"qty_avg_price":141.60,
            "total_avg":"297.44","total_qty_avg":"283.20","purchase_price":120.0}"""
        val s = json.decodeFromString(ValuationSet.serializer(), raw)
        assertEquals(148.72, s.avgPrice!!, 0.001)
        assertEquals("297.44", s.totalAvg)
        assertEquals(120.0, s.purchasePrice!!, 0.001)
    }

    @Test
    fun `missing fields break nothing`() {
        // Older servers do not deliver total_avg and purchase_price.
        val s = json.decodeFromString(ValuationSet.serializer(),
            """{"set_number":"1-1","qty_avg_price":10.0,"total_qty_avg":"10.00"}""")
        assertEquals(null, s.totalAvg)
        assertEquals(null, s.purchasePrice)
        assertEquals("10.00", s.totalQtyAvg)
    }
}

/**
 * Image resolution for minifigures.
 *
 * Since the extension of the img-dl run, the server stores minifigure images
 * locally under /images/ and serves them via express.static — noticeably
 * faster than via the CDN. But the app used only `image_url` exclusively
 * and did not know `image_local` at all; it would have gained nothing from the change.
 */
class MinifigImageFieldTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `image_local is read and takes precedence`() {
        val fig = json.decodeFromString(
            Minifig.serializer(),
            """{"fig_number":"fig-000140","image_url":"https://cdn.rebrickable.com/x.jpg",
                "image_local":"/images/sets/fig-000140.jpg"}"""
        )
        assertEquals("/images/sets/fig-000140.jpg", fig.imageLocal)

        // Resolution as in the screen: local wins, otherwise absolute CDN address
        val serverUrl = "https://lego.example.org"
        val image = fig.imageUrl
        val resolved = when {
            fig.imageLocal != null -> "$serverUrl${fig.imageLocal}"
            image != null && image.startsWith("/") -> "$serverUrl$image"
            else -> image
        }
        assertEquals("https://lego.example.org/images/sets/fig-000140.jpg", resolved)
    }

    @Test
    fun `without image_local the CDN address stays`() {
        // As long as the background run has not yet fetched the image.
        val fig = json.decodeFromString(
            Minifig.serializer(),
            """{"fig_number":"fig-1","image_url":"https://cdn.rebrickable.com/y.jpg"}"""
        )
        assertEquals(null, fig.imageLocal)
        assertEquals("https://cdn.rebrickable.com/y.jpg", fig.imageUrl)
    }

    @Test
    fun `the finance minifigures also know image_local`() {
        val item = json.decodeFromString(
            FigValuationItem.serializer(),
            """{"fig_number":"fig-2","image_local":"/images/sets/fig-2.jpg"}"""
        )
        assertEquals("/images/sets/fig-2.jpg", item.imageLocal)
    }
}

/**
 * Retry for gallery tiles after a load error.
 *
 * Observed: tiles stayed empty, but the image appeared right away as soon as
 * the affected set was opened — a sign of a one-off, transient
 * failure on the first load attempt. Coil does not retry a failed
 * request on its own.
 */
class GalleryImageRetryTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `SetCard retries a failed image exactly once`() {
        val src = read("collection/ui/screens/GalleryCard.kt")

        assert(src.contains("var retryNonce by remember(set.setNumber, imageUrl)")) {
            "Der Wiederholzähler fehlt oder ist nicht je Kachel/Bild gebunden"
        }
        assert(src.contains("AsyncImagePainter.State.Error && retryNonce == 0")) {
            "Der Wiederholversuch muss auf GENAU EINMAL begrenzt sein"
        }
        // Coil 3 no longer knows this parameter; checked in the sources of
        // coil-core 3.3.0, memoryCacheKeyExtra is the successor. What is checked
        // remains the WHAT (a distinguishable feature of the request), not
        // the name of a library function — the name is only here because
        // a text comparison can do nothing else.
        assert(src.contains(".memoryCacheKeyExtra(\"retry\", source.retryNonce.toString())")) {
            "Die Anfrage braucht ein unterscheidbares Merkmal, sonst könnte Coil " +
            "sie mit dem fehlgeschlagenen Vorgänger verwechseln"
        }
        assert(src.contains("kotlinx.coroutines.delay(1000)")) {
            "Der Wiederholversuch sollte verzögert erfolgen, nicht sofort im selben Moment"
        }
    }
}
