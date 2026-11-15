package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.MerkpostenAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenPreiseAnsicht

import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import kotlinx.coroutines.flow.Flow

/** Die Merkliste: Sets, die man noch nicht hat, in der Ablage und ihre Übernahme in den Bestand. */
interface MerklisteRepository {
    /** Die Merkliste aus der Ablage nach Suche und Zustand, sortiert wie am Server. */
    fun beobachteMerkliste(suche: String? = null, zustand: Zustand? = null,
                           sort: Merksortierung? = null): Flow<Lokal<MerkpostenAnsicht>>

    /**
     * Die ungefilterte Merkliste vom Server in die lokale Ablage holen. Zu sehen ist
     * sie nur über [beobachteMerkliste]: ein Weg für die Daten, der Abruf meldet nur
     * Erfolg oder Fehler.
     */
    suspend fun aktualisiereMerkliste(): Ergebnis<Unit>

    /** true, wenn der Posten neu ist; false, wenn er schon auf der Liste stand. */
    suspend fun legeMerkpostenAn(setNumber: String, condition: Zustand,
                                 ownerUserId: Int? = null): Ergebnis<Boolean>

    /** true, wenn er mit einem Posten des Ziels zusammengeführt wurde. */
    suspend fun verschiebeMerkposten(setNumber: String, condition: Zustand,
                                     vonId: Int, zuId: Int): Ergebnis<Boolean>

    suspend fun loescheMerkposten(setNumber: String, condition: Zustand,
                                  ownerUserId: Int? = null): Ergebnis<Unit>

    suspend fun getMerkpostenPreise(setNumber: String): Ergebnis<MerkpostenPreiseAnsicht>

    /**
     * Der Merkposten geht in den Bestand; die Galerie zieht in derselben Ablage nach.
     * true, wenn das Set schon im Bestand war und nur die Menge stieg.
     */
    suspend fun uebernimmMerkposten(setNumber: String, condition: Zustand, quantity: Int = 1,
                                    purchasePrice: Double? = null, erfasstAls: Zustand? = null,
                                    ownerUserId: Int? = null,
                                    storage: String? = null): Ergebnis<Boolean>
}
