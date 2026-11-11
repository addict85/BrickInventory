package ch.brickinventoryapp.data.service

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.fach.PdfFortschritt
import kotlinx.coroutines.flow.Flow
import java.io.File

/** Warum ein PDF-Export scheiterte; den Satz bildet die Oberfläche. */
sealed interface PdfFehlschlag {
    /** Ein Abruf scheiterte; die Anzeige formuliert ihn wie jeden anderen Abruf. */
    data class Abruf(val fehler: Ergebnis.Error) : PdfFehlschlag

    /** Der Server meldet den Auftrag als gescheitert, mit seinem Satz, wenn er einen schickte. */
    data class Auftrag(val satz: String?) : PdfFehlschlag
}

/** Ausgang eines PDF-Exports: die Datei oder der Grund. */
sealed interface ExportErgebnis {
    data class Datei(val datei: File) : ExportErgebnis
    data class Fehler(val grund: PdfFehlschlag) : ExportErgebnis
}

/** Der PDF-Export als Vordergrund-Dienst, der länger lebt als der Bildschirm; im Test ein Double. */
interface TeilelistenExport {
    /** Wo ein laufender Export steht, null ohne Export. */
    val fortschritt: Flow<PdfFortschritt?>
    suspend fun erzeuge(rumpf: String): ExportErgebnis
}
