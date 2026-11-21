package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Offlineablage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject

/**
 * Create a set and follow the server's steps along the way. On the device
 * via the event stream ([SetCreateSseClient]); the interface lets
 * adding be checked without network and settings.
 */
interface SetCreator {
    fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Geld?,
        condition: Zustand?, ownerUserId: Int?, storage: String? = null,
    ): Flow<SetCreateStep>
}

/** What the server reports during creation; the last step is Fertig, Fehler or NoConnection. */
sealed class SetCreateStep {
    data class Stammdaten(val name: String?) : SetCreateStep()
    object Bild : SetCreateStep()
    object FastDone : SetCreateStep()
    data class Fertig(val ergebnis: SetRecorded) : SetCreateStep()
    /** The server's sentence; empty: the stream broke off, whether the set was created is open. */
    data class Fehler(val meldung: String) : SetCreateStep()
    /** No connection established — the request never reached the server. */
    object NoConnection : SetCreateStep()
}

/**
 * Creating via the event stream updates the store like every other
 * write path: the gallery shows the set as soon as the server reports „done“.
 */
internal class CreateWithStore @Inject constructor(
    private val strom: SetCreateSseClient,
    private val ablage: Offlineablage,
) : SetCreator {
    override fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Geld?,
        condition: Zustand?, ownerUserId: Int?, storage: String?,
    ): Flow<SetCreateStep> = flow {
        val vorher = ablage.bereich()
        strom.anlegen(setNumber, quantity, purchasePrice, condition, ownerUserId, storage).collect { s ->
            val e = (s as? SetCreateStep.Fertig)?.ergebnis
            if (e != null && !e.vorhanden && vorher != null && ablage.bereich() == vorher) {
                val nummer = e.nummer ?: setNumber
                ablage.applyAn(Editing.SetErfassen(Erfassungswunsch(setNumber = nummer, menge = quantity, kaufpreis = purchasePrice,
                    zustand = condition, besitzer = ownerUserId, lagerort = storage)), vorher)
            }
            emit(s)
        }
    }
}
