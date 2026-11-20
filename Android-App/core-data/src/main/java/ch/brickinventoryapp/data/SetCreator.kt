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
 * Ein Set anlegen und dabei die Schritte des Servers mitbekommen. Im Gerät
 * über den Ereignisstrom ([SetCreateSseClient]); die Schnittstelle lässt die
 * Erfassung ohne Netz und Einstellungen prüfen.
 */
interface SetCreator {
    fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Geld?,
        condition: Zustand?, ownerUserId: Int?, storage: String? = null,
    ): Flow<SetCreateStep>
}

/** Was der Server beim Anlegen meldet; der letzte Schritt ist Fertig, Fehler oder NoConnection. */
sealed class SetCreateStep {
    data class Stammdaten(val name: String?) : SetCreateStep()
    object Bild : SetCreateStep()
    object FastDone : SetCreateStep()
    data class Fertig(val ergebnis: SetRecorded) : SetCreateStep()
    /** Der Satz des Servers; leer: Der Strom brach ab, ob das Set angelegt wurde, ist offen. */
    data class Fehler(val meldung: String) : SetCreateStep()
    /** Keine Verbindung zustande gekommen — die Anfrage hat den Server nie erreicht. */
    object NoConnection : SetCreateStep()
}

/**
 * Das Anlegen über den Ereignisstrom zieht die Ablage nach wie jeder andere
 * Schreibweg: Die Galerie zeigt das Set, sobald der Server „fertig“ meldet.
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
