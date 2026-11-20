package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.WantedItemView
import ch.brickinventoryapp.model.fach.WantedItemPricesView

import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Local
import kotlinx.coroutines.flow.Flow

/** Die Merkliste: Sets, die man noch nicht hat, in der Ablage und ihre Übernahme in den Bestand. */
interface WantedRepository {
    /** Die Merkliste aus der Ablage nach Suche und Zustand, sortiert wie am Server. */
    fun observeWanted(suche: String? = null, zustand: Zustand? = null,
                           sort: Merksortierung? = null): Flow<Local<WantedItemView>>

    /**
     * Die ungefilterte Merkliste vom Server in die lokale Ablage holen. Zu sehen ist
     * sie nur über [observeWanted]: ein Weg für die Daten, der Abruf meldet nur
     * Erfolg oder Fehler.
     */
    suspend fun refreshWanted(): Ergebnis<Unit>

    /** true, wenn der Posten neu ist; false, wenn er schon auf der Liste stand. */
    suspend fun legeMerkpostenAn(setNumber: String, condition: Zustand,
                                 ownerUserId: Int? = null): Ergebnis<Boolean>

    /** true, wenn er mit einem Posten des Ziels zusammengeführt wurde. */
    suspend fun moveWantedItem(setNumber: String, condition: Zustand,
                                     ofId: Int, toId: Int): Ergebnis<Boolean>

    suspend fun deleteWantedItem(setNumber: String, condition: Zustand,
                                  ownerUserId: Int? = null): Ergebnis<Unit>

    suspend fun getWantedItemPrices(setNumber: String): Ergebnis<WantedItemPricesView>

    /**
     * Der Merkposten geht in den Bestand; die Galerie zieht in derselben Ablage nach.
     * true, wenn das Set schon im Bestand war und nur die Menge stieg.
     */
    suspend fun adoptWantedItem(setNumber: String, condition: Zustand, quantity: Int = 1,
                                    purchasePrice: Geld? = null, recordedAs: Zustand? = null,
                                    ownerUserId: Int? = null,
                                    storage: String? = null): Ergebnis<Boolean>
}
