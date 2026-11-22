package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.domain.QuantityChange
import ch.brickinventoryapp.model.domain.WantedRequest
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.descriptors.elementNames
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The outbox lies in its own form (version 1), not as a server request. The
 * examples below were written by the app before the separation (edit including AddSetRequest &
 * co. as JSON); they lie like this on devices and must stay readable.
 *
 * Counter-checks (measured with kotlinc against core-model and core-offline):
 *   A  counter-checks/ausgangsform-feldname-geaendert.patch (SetRequestF1 `set_number` → `setNumber`) → red “reads and writes every
 *      frozen row” (set_erfassen) and “an item of an older app …”
 *   B  in AddSetRequest (setNumber = server model) `@SerialName("set_number")` → `"set_nr"` → stays green:
 *      a change to the network model no longer reaches the disk
 *   C  in Ausgangsform.targetFrom the lookup in `request` struck → red “even an unreadable
 *      item names its number”
 *   D  an example struck from VERSION_1 → red “every kind of version 1 has an example”
 */
class InitialFormTest {

    private val json = BrickJson

    private val VERSION_1: List<Pair<String, Editing>> = listOf(
        """{"type":"set_menge","setNumber":"10001-1","schritt":-2}""" to Editing.SetQuantity("10001-1", -2),
        """{"type":"set_erfassen","anfrage":{"set_number":"10001-1","quantity":2,"purchase_price":49.9,"condition":"U","owner_user_id":7,"storage":"Regal A"}}""" to
            Editing.RecordSet(EntryRequest(setNumber = "10001-1", quantity = 2, purchasePrice = Money.from(49.9), condition = Condition.USED, owner = 7, storageLocation = "Regal A")),
        """{"type":"merkposten_anlegen","anfrage":{"set_number":"75192-1","condition":"N","owner_user_id":3}}""" to
            Editing.CreateWantedItem(WantedRequest(setNumber = "75192-1", condition = Condition.NEW, owner = 3)),
        """{"type":"merkposten_loeschen","setNumber":"75192-1","zustand":"U","besitzer":null}""" to
            Editing.DeleteWantedItem("75192-1", Condition.USED, null),
        """{"type":"teil_erfassen","anfrage":{"part_number":"3001","color_id":5,"color_name":"Red","color_hex":"C91A09","quantity":4,"unit_price":0.12,"condition":"N","owner_user_id":null,"storage":"Kiste 3"}}""" to
            Editing.RecordPart(PartEntry(number = "3001", colorId = 5, colorName = "Red", colorHex = "C91A09", quantity = 4, unitPrice = Money.from(0.12), condition = Condition.NEW, owner = null, storageLocation = "Kiste 3")),
        """{"type":"teil_aendern","partNumber":"3001","colorId":5,"anfrage":{"quantity":6,"unit_price":0.15,"bl_fig_number":null,"condition":"U","quantity_delta":2},"besitzer":7}""" to
            Editing.EditPart("3001", 5, QuantityChange(quantity = 6, step = 2, unitPrice = Money.from(0.15), condition = Condition.USED), 7),
        """{"type":"teil_aendern","partNumber":"3001","colorId":5,"anfrage":{"quantity":6,"unit_price":null,"bl_fig_number":null,"condition":null},"besitzer":null}""" to
            Editing.EditPart("3001", 5, QuantityChange(quantity = 6), null),
        """{"type":"teil_loeschen","partNumber":"3001","colorId":5,"besitzer":7}""" to Editing.DeletePart("3001", 5, 7),
        """{"type":"figur_erfassen","anfrage":{"fig_number":"fig-000001","bl_fig_number":"sw0001","quantity":1,"unit_price":3.5,"condition":"N","owner_user_id":7,"storage":null}}""" to
            Editing.RecordFigure(FigureEntry(number = "fig-000001", blNumber = "sw0001", quantity = 1, unitPrice = Money.from(3.5), condition = Condition.NEW, owner = 7, storageLocation = null)),
        """{"type":"figur_aendern","figNumber":"fig-000001","anfrage":{"quantity":2,"unit_price":null,"bl_fig_number":"sw0001","condition":null},"besitzer":null}""" to
            Editing.EditFigure("fig-000001", QuantityChange(quantity = 2, blNumber = "sw0001"), null),
        """{"type":"figur_loeschen","figNumber":"fig-000001","besitzer":7}""" to Editing.DeleteFigure("fig-000001", 7),
    )

    @Test
    fun `reads and writes every frozen row of version 1 unchanged`() {
        for ((row, editing) in VERSION_1) {
            assertEquals(row, editing, InitialForm.decode(json, row))
            assertEquals(row, InitialForm.encode(json, editing))
        }
    }

    @Test
    fun `every kind of version 1 has an example`() {
        val kinds = ItemF1.serializer().descriptor.getElementDescriptor(1).elementNames.toSet()
        val occupied = VERSION_1.map { json.parseToJsonElement(it.first).jsonObject["type"]!!.jsonPrimitive.content }.toSet()
        assertEquals(kinds, occupied)
    }

    @Test
    fun `an item of an older app without fields added later stays readable`() {
        assertEquals(Editing.RecordSet(EntryRequest(setNumber = "10001-1")),
            InitialForm.decode(json, """{"type":"set_erfassen","anfrage":{"set_number":"10001-1"}}"""))
        assertEquals(Editing.RecordPart(PartEntry(number = "3001", quantity = 2)),
            InitialForm.decode(json, """{"type":"teil_erfassen","anfrage":{"part_number":"3001","quantity":2}}"""))
        assertEquals(Editing.DeletePart("3001", 5, null),
            InitialForm.decode(json, """{"type":"teil_loeschen","partNumber":"3001","colorId":5}"""))
    }

    @Test
    fun `even an unreadable item names its number where it is still present`() {
        assertEquals("10001-1", InitialForm.targetFrom(json, """{"type":"gibt_es_nicht","setNumber":"10001-1"}"""))
        assertEquals("3001", InitialForm.targetFrom(json, """{"type":"neu","anfrage":{"part_number":"3001"}}"""))
        assertNull(InitialForm.targetFrom(json, """{"type":"neu"}"""))
        assertNull(InitialForm.targetFrom(json, "kein JSON"))
    }
}
