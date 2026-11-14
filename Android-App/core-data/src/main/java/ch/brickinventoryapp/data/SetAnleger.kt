package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.vertrag.AddSetRequest
import ch.brickinventoryapp.vertrag.AddSetResponse
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

/** Was der Server beim Anlegen meldet; der letzte Schritt ist Fertig oder Fehler. */
sealed class SetAnlegenSchritt {
    data class Stammdaten(val name: String?) : SetAnlegenSchritt()
    object Bild : SetAnlegenSchritt()
    object FastFertig : SetAnlegenSchritt()
    data class Fertig(val ergebnis: AddSetResponse) : SetAnlegenSchritt()
    /** Leere Meldung: Die Verbindung brach ab — ein Netzfehler, kein Satz des Servers. */
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
            if (e != null && e.success && e.action != "exists" && vorher != null && ablage.bereich() == vorher) {
                val nummer = e.setNumber ?: setNumber
                ablage.wendeAn(Bearbeitung.SetErfassen(AddSetRequest(nummer, quantity, purchasePrice, condition, ownerUserId, storage)), vorher)
            }
            emit(s)
        }
    }
}
