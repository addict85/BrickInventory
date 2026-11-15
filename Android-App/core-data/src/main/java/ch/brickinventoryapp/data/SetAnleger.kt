package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.vertrag.AddSetRequest
import ch.brickinventoryapp.model.fach.SetErfasst
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Offlineablage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject

/**
 * Ein Set anlegen und dabei die Schritte des Servers mitbekommen. Im Gerät
 * über den Ereignisstrom ([SetAnlegenSseClient]); die Schnittstelle lässt die
 * Erfassung ohne Netz und Einstellungen prüfen.
 */
interface SetAnleger {
    fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Double?,
        condition: Zustand?, ownerUserId: Int?, storage: String? = null,
    ): Flow<SetAnlegenSchritt>
}

/** Was der Server beim Anlegen meldet; der letzte Schritt ist Fertig, Fehler oder KeineVerbindung. */
sealed class SetAnlegenSchritt {
    data class Stammdaten(val name: String?) : SetAnlegenSchritt()
    object Bild : SetAnlegenSchritt()
    object FastFertig : SetAnlegenSchritt()
    data class Fertig(val ergebnis: SetErfasst) : SetAnlegenSchritt()
    /** Der Satz des Servers; leer: Der Strom brach ab, ob das Set angelegt wurde, ist offen. */
    data class Fehler(val meldung: String) : SetAnlegenSchritt()
    /** Keine Verbindung zustande gekommen — die Anfrage hat den Server nie erreicht. */
    object KeineVerbindung : SetAnlegenSchritt()
}

/**
 * Das Anlegen über den Ereignisstrom zieht die Ablage nach wie jeder andere
 * Schreibweg: Die Galerie zeigt das Set, sobald der Server „fertig“ meldet.
 */
internal class AnlegenMitAblage @Inject constructor(
    private val strom: SetAnlegenSseClient,
    private val ablage: Offlineablage,
) : SetAnleger {
    override fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Double?,
        condition: Zustand?, ownerUserId: Int?, storage: String?,
    ): Flow<SetAnlegenSchritt> = flow {
        val vorher = ablage.bereich()
        strom.anlegen(setNumber, quantity, purchasePrice, condition, ownerUserId, storage).collect { s ->
            val e = (s as? SetAnlegenSchritt.Fertig)?.ergebnis
            if (e != null && !e.vorhanden && vorher != null && ablage.bereich() == vorher) {
                val nummer = e.nummer ?: setNumber
                ablage.wendeAn(Bearbeitung.SetErfassen(AddSetRequest(setNumber = nummer, quantity = quantity, purchasePrice = purchasePrice, condition = condition, ownerUserId = ownerUserId, storage = storage)), vorher)
            }
            emit(s)
        }
    }
}
