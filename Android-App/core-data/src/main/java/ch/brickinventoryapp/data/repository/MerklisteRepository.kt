package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.vertrag.GenericResponse
import ch.brickinventoryapp.vertrag.Merkposten
import ch.brickinventoryapp.vertrag.MerkpostenAntwort
import ch.brickinventoryapp.vertrag.MerkpostenInhaberAntwort
import ch.brickinventoryapp.vertrag.MerkpostenPreiseResponse
import ch.brickinventoryapp.vertrag.MerkpostenUebernahmeResponse
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import kotlinx.coroutines.flow.Flow

/** Die Merkliste: Sets, die man noch nicht hat, in der Ablage und ihre Übernahme in den Bestand. */
interface MerklisteRepository {
    /** Die Merkliste aus der Ablage nach Suche und Zustand, sortiert wie am Server. */
    fun beobachteMerkliste(suche: String? = null, zustand: Zustand? = null,
                           sort: Merksortierung? = null): Flow<Lokal<Merkposten>>

    /**
     * Die ungefilterte Merkliste vom Server in die lokale Ablage holen. Zu sehen ist
     * sie nur über [beobachteMerkliste]: ein Weg für die Daten, der Abruf meldet nur
     * Erfolg oder Fehler.
     */
    suspend fun aktualisiereMerkliste(): Ergebnis<Unit>

    suspend fun legeMerkpostenAn(setNumber: String, condition: Zustand,
                                 ownerUserId: Int? = null): Ergebnis<MerkpostenAntwort>

    suspend fun verschiebeMerkposten(setNumber: String, condition: Zustand,
                                     vonId: Int, zuId: Int): Ergebnis<MerkpostenInhaberAntwort>

    suspend fun loescheMerkposten(setNumber: String, condition: Zustand,
                                  ownerUserId: Int? = null): Ergebnis<GenericResponse>

    suspend fun getMerkpostenPreise(setNumber: String): Ergebnis<MerkpostenPreiseResponse>

    /** Der Merkposten geht in den Bestand; die Galerie zieht in derselben Ablage nach. */
    suspend fun uebernimmMerkposten(setNumber: String, condition: Zustand, quantity: Int = 1,
                                    purchasePrice: Double? = null, erfasstAls: Zustand? = null,
                                    ownerUserId: Int? = null,
                                    storage: String? = null): Ergebnis<MerkpostenUebernahmeResponse>
}
