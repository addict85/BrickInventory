package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Stueckaenderung
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Merkwunsch
import ch.brickinventoryapp.model.fach.Erfassungswunsch
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
 *   A  gegenproben/ausgangsform-feldname-geaendert.patch (SetRequestF1 `set_number` → `setNumber`) → rot „liest und schreibt jede
 *      eingefrorene Zeile“ (set_erfassen) und „ein Posten einer älteren App …“
 *   B  in AddSetRequest (setNumber = Servermodell) `@SerialName("set_number")` → `"set_nr"` → bleibt grün:
 *      Eine Änderung am Netzmodell erreicht die Platte nicht mehr
 *   C  in Ausgangsform.targetFrom das Nachsehen in `anfrage` gestrichen → rot „auch ein unlesbarer
 *      Posten nennt seine Nummer“
 *   D  ein Beispiel aus VERSION_1 gestrichen → rot „jede Art der Fassung 1 hat ein Beispiel“
 */
class InitialFormTest {

    private val json = BrickJson

    private val VERSION_1: List<Pair<String, Editing>> = listOf(
        """{"type":"set_menge","setNumber":"10001-1","schritt":-2}""" to Editing.SetMenge("10001-1", -2),
        """{"type":"set_erfassen","anfrage":{"set_number":"10001-1","quantity":2,"purchase_price":49.9,"condition":"U","owner_user_id":7,"storage":"Regal A"}}""" to
            Editing.SetErfassen(Erfassungswunsch(setNumber = "10001-1", menge = 2, kaufpreis = Geld.aus(49.9), zustand = Zustand.GEBRAUCHT, besitzer = 7, lagerort = "Regal A")),
        """{"type":"merkposten_anlegen","anfrage":{"set_number":"75192-1","condition":"N","owner_user_id":3}}""" to
            Editing.MerkpostenAnlegen(Merkwunsch(setNumber = "75192-1", zustand = Zustand.NEU, besitzer = 3)),
        """{"type":"merkposten_loeschen","setNumber":"75192-1","zustand":"U","besitzer":null}""" to
            Editing.MerkpostenLoeschen("75192-1", Zustand.GEBRAUCHT, null),
        """{"type":"teil_erfassen","anfrage":{"part_number":"3001","color_id":5,"color_name":"Red","color_hex":"C91A09","quantity":4,"unit_price":0.12,"condition":"N","owner_user_id":null,"storage":"Kiste 3"}}""" to
            Editing.TeilErfassen(Teilerfassung(nummer = "3001", farbId = 5, farbname = "Red", farbHex = "C91A09", menge = 4, stueckpreis = Geld.aus(0.12), zustand = Zustand.NEU, besitzer = null, lagerort = "Kiste 3")),
        """{"type":"teil_aendern","partNumber":"3001","colorId":5,"anfrage":{"quantity":6,"unit_price":0.15,"bl_fig_number":null,"condition":"U","quantity_delta":2},"besitzer":7}""" to
            Editing.TeilAendern("3001", 5, Stueckaenderung(menge = 6, schritt = 2, stueckpreis = Geld.aus(0.15), zustand = Zustand.GEBRAUCHT), 7),
        """{"type":"teil_aendern","partNumber":"3001","colorId":5,"anfrage":{"quantity":6,"unit_price":null,"bl_fig_number":null,"condition":null},"besitzer":null}""" to
            Editing.TeilAendern("3001", 5, Stueckaenderung(menge = 6), null),
        """{"type":"teil_loeschen","partNumber":"3001","colorId":5,"besitzer":7}""" to Editing.TeilLoeschen("3001", 5, 7),
        """{"type":"figur_erfassen","anfrage":{"fig_number":"fig-000001","bl_fig_number":"sw0001","quantity":1,"unit_price":3.5,"condition":"N","owner_user_id":7,"storage":null}}""" to
            Editing.FigurErfassen(Figurenerfassung(nummer = "fig-000001", blNumber = "sw0001", menge = 1, stueckpreis = Geld.aus(3.5), zustand = Zustand.NEU, besitzer = 7, lagerort = null)),
        """{"type":"figur_aendern","figNumber":"fig-000001","anfrage":{"quantity":2,"unit_price":null,"bl_fig_number":"sw0001","condition":null},"besitzer":null}""" to
            Editing.FigurAendern("fig-000001", Stueckaenderung(menge = 2, blNumber = "sw0001"), null),
        """{"type":"figur_loeschen","figNumber":"fig-000001","besitzer":7}""" to Editing.FigurLoeschen("fig-000001", 7),
    )

    @Test
    fun `liest und schreibt jede eingefrorene Zeile der Fassung 1 unverändert`() {
        for ((zeile, bearbeitung) in VERSION_1) {
            assertEquals(zeile, bearbeitung, InitialForm.decode(json, zeile))
            assertEquals(zeile, InitialForm.encode(json, bearbeitung))
        }
    }

    @Test
    fun `jede Art der Fassung 1 hat ein Beispiel`() {
        val kinds = ItemF1.serializer().descriptor.getElementDescriptor(1).elementNames.toSet()
        val belegt = VERSION_1.map { json.parseToJsonElement(it.first).jsonObject["type"]!!.jsonPrimitive.content }.toSet()
        assertEquals(kinds, belegt)
    }

    @Test
    fun `ein Posten einer älteren App ohne später dazugekommene Felder bleibt lesbar`() {
        assertEquals(Editing.SetErfassen(Erfassungswunsch(setNumber = "10001-1")),
            InitialForm.decode(json, """{"type":"set_erfassen","anfrage":{"set_number":"10001-1"}}"""))
        assertEquals(Editing.TeilErfassen(Teilerfassung(nummer = "3001", menge = 2)),
            InitialForm.decode(json, """{"type":"teil_erfassen","anfrage":{"part_number":"3001","quantity":2}}"""))
        assertEquals(Editing.TeilLoeschen("3001", 5, null),
            InitialForm.decode(json, """{"type":"teil_loeschen","partNumber":"3001","colorId":5}"""))
    }

    @Test
    fun `auch ein unlesbarer Posten nennt seine Nummer, wo sie noch steht`() {
        assertEquals("10001-1", InitialForm.targetFrom(json, """{"type":"gibt_es_nicht","setNumber":"10001-1"}"""))
        assertEquals("3001", InitialForm.targetFrom(json, """{"type":"neu","anfrage":{"part_number":"3001"}}"""))
        assertNull(InitialForm.targetFrom(json, """{"type":"neu"}"""))
        assertNull(InitialForm.targetFrom(json, "kein JSON"))
    }
}
