package ch.brickinventoryapp.offline

import ch.brickinventoryapp.vertrag.AddMinifigRequest
import ch.brickinventoryapp.vertrag.AddPartRequest
import ch.brickinventoryapp.vertrag.AddSetRequest
import ch.brickinventoryapp.vertrag.MerkpostenRequest
import ch.brickinventoryapp.vertrag.UpdateManualItemRequest
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.descriptors.elementNames
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Der Ausgang liegt in seiner eigenen Form (Fassung 1), nicht als Server-Anfrage. Die
 * Beispiele unten hat die App vor der Trennung geschrieben (Bearbeitung samt AddSetRequest &
 * Co. als JSON); sie liegen so auf Geräten und müssen lesbar bleiben.
 *
 * Gegenproben (mit kotlinc gegen core-model und core-offline gemessen):
 *   A  gegenproben/ausgangsform-feldname-geaendert.patch (SetAnfrageF1 `set_number` → `setNumber`) → rot „liest und schreibt jede
 *      eingefrorene Zeile“ (set_erfassen) und „ein Posten einer älteren App …“
 *   B  in AddSetRequest (Servermodell) `@SerialName("set_number")` → `"set_nr"` → bleibt grün:
 *      Eine Änderung am Netzmodell erreicht die Platte nicht mehr
 *   C  in Ausgangsform.zielAus das Nachsehen in `anfrage` gestrichen → rot „auch ein unlesbarer
 *      Posten nennt seine Nummer“
 *   D  ein Beispiel aus FASSUNG_1 gestrichen → rot „jede Art der Fassung 1 hat ein Beispiel“
 */
class AusgangsformTest {

    private val json = BrickJson

    private val FASSUNG_1: List<Pair<String, Bearbeitung>> = listOf(
        """{"type":"set_menge","setNumber":"10001-1","schritt":-2}""" to Bearbeitung.SetMenge("10001-1", -2),
        """{"type":"set_erfassen","anfrage":{"set_number":"10001-1","quantity":2,"purchase_price":49.9,"condition":"U","owner_user_id":7,"storage":"Regal A"}}""" to
            Bearbeitung.SetErfassen(AddSetRequest("10001-1", 2, 49.9, Zustand.GEBRAUCHT, 7, "Regal A")),
        """{"type":"merkposten_anlegen","anfrage":{"set_number":"75192-1","condition":"N","owner_user_id":3}}""" to
            Bearbeitung.MerkpostenAnlegen(MerkpostenRequest("75192-1", Zustand.NEU, 3)),
        """{"type":"merkposten_loeschen","setNumber":"75192-1","zustand":"U","besitzer":null}""" to
            Bearbeitung.MerkpostenLoeschen("75192-1", Zustand.GEBRAUCHT, null),
        """{"type":"teil_erfassen","anfrage":{"part_number":"3001","color_id":5,"color_name":"Red","color_hex":"C91A09","quantity":4,"unit_price":0.12,"condition":"N","owner_user_id":null,"storage":"Kiste 3"}}""" to
            Bearbeitung.TeilErfassen(AddPartRequest("3001", 5, "Red", "C91A09", 4, 0.12, Zustand.NEU, null, "Kiste 3")),
        """{"type":"teil_aendern","partNumber":"3001","colorId":5,"anfrage":{"quantity":6,"unit_price":0.15,"bl_fig_number":null,"condition":"U","quantity_delta":2},"besitzer":7}""" to
            Bearbeitung.TeilAendern("3001", 5, UpdateManualItemRequest(6, 0.15, null, Zustand.GEBRAUCHT, 2), 7),
        """{"type":"teil_aendern","partNumber":"3001","colorId":5,"anfrage":{"quantity":6,"unit_price":null,"bl_fig_number":null,"condition":null},"besitzer":null}""" to
            Bearbeitung.TeilAendern("3001", 5, UpdateManualItemRequest(6), null),
        """{"type":"teil_loeschen","partNumber":"3001","colorId":5,"besitzer":7}""" to Bearbeitung.TeilLoeschen("3001", 5, 7),
        """{"type":"figur_erfassen","anfrage":{"fig_number":"fig-000001","bl_fig_number":"sw0001","quantity":1,"unit_price":3.5,"condition":"N","owner_user_id":7,"storage":null}}""" to
            Bearbeitung.FigurErfassen(AddMinifigRequest("fig-000001", "sw0001", 1, 3.5, Zustand.NEU, 7, null)),
        """{"type":"figur_aendern","figNumber":"fig-000001","anfrage":{"quantity":2,"unit_price":null,"bl_fig_number":"sw0001","condition":null},"besitzer":null}""" to
            Bearbeitung.FigurAendern("fig-000001", UpdateManualItemRequest(2, null, "sw0001", null, null), null),
        """{"type":"figur_loeschen","figNumber":"fig-000001","besitzer":7}""" to Bearbeitung.FigurLoeschen("fig-000001", 7),
    )

    @Test
    fun `liest und schreibt jede eingefrorene Zeile der Fassung 1 unverändert`() {
        for ((zeile, bearbeitung) in FASSUNG_1) {
            assertEquals(zeile, bearbeitung, Ausgangsform.dekodiere(json, zeile))
            assertEquals(zeile, Ausgangsform.kodiere(json, bearbeitung))
        }
    }

    @Test
    fun `jede Art der Fassung 1 hat ein Beispiel`() {
        val arten = PostenF1.serializer().descriptor.getElementDescriptor(1).elementNames.toSet()
        val belegt = FASSUNG_1.map { json.parseToJsonElement(it.first).jsonObject["type"]!!.jsonPrimitive.content }.toSet()
        assertEquals(arten, belegt)
    }

    @Test
    fun `ein Posten einer älteren App ohne später dazugekommene Felder bleibt lesbar`() {
        assertEquals(Bearbeitung.SetErfassen(AddSetRequest("10001-1")),
            Ausgangsform.dekodiere(json, """{"type":"set_erfassen","anfrage":{"set_number":"10001-1"}}"""))
        assertEquals(Bearbeitung.TeilErfassen(AddPartRequest("3001", quantity = 2)),
            Ausgangsform.dekodiere(json, """{"type":"teil_erfassen","anfrage":{"part_number":"3001","quantity":2}}"""))
        assertEquals(Bearbeitung.TeilLoeschen("3001", 5, null),
            Ausgangsform.dekodiere(json, """{"type":"teil_loeschen","partNumber":"3001","colorId":5}"""))
    }

    @Test
    fun `auch ein unlesbarer Posten nennt seine Nummer, wo sie noch steht`() {
        assertEquals("10001-1", Ausgangsform.zielAus(json, """{"type":"gibt_es_nicht","setNumber":"10001-1"}"""))
        assertEquals("3001", Ausgangsform.zielAus(json, """{"type":"neu","anfrage":{"part_number":"3001"}}"""))
        assertNull(Ausgangsform.zielAus(json, """{"type":"neu"}"""))
        assertNull(Ausgangsform.zielAus(json, "kein JSON"))
    }
}
