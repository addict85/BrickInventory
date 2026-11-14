package ch.brickinventoryapp.sammlung

import ch.brickinventoryapp.model.data.model.MinifigsResponse
import ch.brickinventoryapp.model.data.model.SetsResponse
import ch.brickinventoryapp.model.data.model.ValuationSet
import ch.brickinventoryapp.model.data.model.StatsResponse
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import ch.brickinventoryapp.model.data.model.FigValuationItem
import ch.brickinventoryapp.model.data.model.Minifig
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Die Ablage legt Kennzahlen und Katalog-Metadaten so ab, wie der Server sie schickt
 * (Ablageform.direkt), und liest sie zurück, wenn ein Abruf scheitert. Das trägt nur,
 * solange diese Antworten verlustfrei durch die Serialisierung gehen; die Listen
 * prüft AblageformTest mit ihrer eigenen Form.
 */
class ResponseCacheContractTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `SetsResponse ueberlebt die Runde`() {
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
        // Verschachtelte Listen sind der Punkt, an dem eine relationale
        // Zwischenschicht TypeConverter gebraucht hätte.
        assertEquals(1, round.sets[0].instructions.size)
        assertEquals(2, round.sets[0].quantity)
    }

    @Test
    fun `MinifigsResponse ueberlebt die Runde`() {
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
    fun `StatsResponse ueberlebt die Runde`() {
        val raw = """{"success":true,"stats":{"total_sets":380,"total_quantity":400,"total_pieces":243700,"total_instructions":12,"total_parts":0,"total_minifigs":9}}"""
        val decoded = json.decodeFromString(StatsResponse.serializer(), raw)
        val round = json.decodeFromString(StatsResponse.serializer(),
            json.encodeToString(StatsResponse.serializer(), decoded))
        assertNotNull(round.stats)
    }

    @Test
    fun `unbekannte Felder brechen den Cache nicht`() {
        // Der Server darf seine Antwort erweitern, ohne dass ein alter
        // Cache-Eintrag unlesbar wird.
        val raw = """{"success":true,"sets":[{"set_number":"1-1","neues_feld":42}],"noch_eins":"x"}"""
        val decoded = json.decodeFromString(SetsResponse.serializer(), raw)
        assertEquals(1, decoded.sets.size)
    }
}

/**
 * Preisfelder der Finanz-Antwort.
 *
 * Der Marktpreis ist seit der serverseitigen Umstellung `avg_price`, nicht der
 * mengengewichtete Schnitt — der liegt systematisch darunter und war der Grund,
 * warum die App im Finanzen-Reiter und im Detail-Dialog einen zu niedrigen Wert
 * zeigte. Dazu liefert der Server jetzt den mengengewichteten Kaufpreis mit.
 */
class ValuationPriceFieldsTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `total_avg und purchase_price werden gelesen`() {
        val raw = """{"set_number":"10290-1","quantity":2,
            "avg_price":148.72,"qty_avg_price":141.60,
            "total_avg":"297.44","total_qty_avg":"283.20","purchase_price":120.0}"""
        val s = json.decodeFromString(ValuationSet.serializer(), raw)
        assertEquals(148.72, s.avgPrice!!, 0.001)
        assertEquals("297.44", s.totalAvg)
        assertEquals(120.0, s.purchasePrice!!, 0.001)
    }

    @Test
    fun `fehlende Felder brechen nichts`() {
        // Ältere Server liefern total_avg und purchase_price nicht.
        val s = json.decodeFromString(ValuationSet.serializer(),
            """{"set_number":"1-1","qty_avg_price":10.0,"total_qty_avg":"10.00"}""")
        assertEquals(null, s.totalAvg)
        assertEquals(null, s.purchasePrice)
        assertEquals("10.00", s.totalQtyAvg)
    }
}

/**
 * Bildauflösung für Minifiguren.
 *
 * Der Server legt Minifiguren-Bilder seit der Erweiterung des img-dl-Laufs
 * lokal unter /images/ ab und liefert sie über express.static — deutlich
 * schneller als über das CDN. Die App nutzte aber ausschliesslich `image_url`
 * und kannte `image_local` gar nicht; sie hätte von der Änderung nichts gehabt.
 */
class MinifigImageFieldTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `image_local wird gelesen und hat Vorrang`() {
        val fig = json.decodeFromString(
            Minifig.serializer(),
            """{"fig_number":"fig-000140","image_url":"https://cdn.rebrickable.com/x.jpg",
                "image_local":"/images/sets/fig-000140.jpg"}"""
        )
        assertEquals("/images/sets/fig-000140.jpg", fig.imageLocal)

        // Auflösung wie im Screen: lokal gewinnt, sonst absolute CDN-Adresse
        val serverUrl = "https://lego.example.org"
        val bild = fig.imageUrl
        val resolved = when {
            fig.imageLocal != null -> "$serverUrl${fig.imageLocal}"
            bild != null && bild.startsWith("/") -> "$serverUrl$bild"
            else -> bild
        }
        assertEquals("https://lego.example.org/images/sets/fig-000140.jpg", resolved)
    }

    @Test
    fun `ohne image_local bleibt die CDN-Adresse`() {
        // Solange der Hintergrundlauf das Bild noch nicht geholt hat.
        val fig = json.decodeFromString(
            Minifig.serializer(),
            """{"fig_number":"fig-1","image_url":"https://cdn.rebrickable.com/y.jpg"}"""
        )
        assertEquals(null, fig.imageLocal)
        assertEquals("https://cdn.rebrickable.com/y.jpg", fig.imageUrl)
    }

    @Test
    fun `auch die Finanz-Minifiguren kennen image_local`() {
        val item = json.decodeFromString(
            FigValuationItem.serializer(),
            """{"fig_number":"fig-2","image_local":"/images/sets/fig-2.jpg"}"""
        )
        assertEquals("/images/sets/fig-2.jpg", item.imageLocal)
    }
}

/**
 * Wiederholversuch für Galerie-Kacheln nach einem Ladefehler.
 *
 * Beobachtet: Kacheln blieben leer, das Bild erschien aber sofort, sobald man
 * das betroffene Set öffnete — ein Hinweis auf einen einmaligen, transienten
 * Fehlschlag beim ersten Ladeversuch. Coil versucht eine fehlgeschlagene
 * Anfrage nicht von sich aus erneut.
 */
class GalleryImageRetryTest {

    private fun read(rel: String): String {
        val f = File(Quellen.wurzel, rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `SetCard versucht ein fehlgeschlagenes Bild genau einmal erneut`() {
        val src = read("sammlung/ui/screens/GalerieKarte.kt")

        assert(src.contains("var retryNonce by remember(set.setNumber, imageUrl)")) {
            "Der Wiederholzähler fehlt oder ist nicht je Kachel/Bild gebunden"
        }
        assert(src.contains("AsyncImagePainter.State.Error && retryNonce == 0")) {
            "Der Wiederholversuch muss auf GENAU EINMAL begrenzt sein"
        }
        // Coil 3 kennt keine Parameter mehr; nachgesehen in den Quellen von
        // coil-core 3.3.0 ist memoryCacheKeyExtra der Nachfolger. Geprüft wird
        // weiter das WAS (ein unterscheidbares Merkmal an der Anfrage), nicht
        // der Name einer Bibliotheksfunktion — der Name steht hier nur, weil
        // ein Textvergleich nichts anderes kann.
        assert(src.contains(".memoryCacheKeyExtra(\"retry\", retryNonce.toString())")) {
            "Die Anfrage braucht ein unterscheidbares Merkmal, sonst könnte Coil " +
            "sie mit dem fehlgeschlagenen Vorgänger verwechseln"
        }
        assert(src.contains("kotlinx.coroutines.delay(1000)")) {
            "Der Wiederholversuch sollte verzögert erfolgen, nicht sofort im selben Moment"
        }
    }
}
