package ch.brickinventoryapp.data.service

import ch.brickinventoryapp.model.fach.Teilelistenauftrag
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.fach.PdfProgress
import kotlinx.coroutines.flow.Flow
import java.io.File

/** Warum ein PDF-Export scheiterte; den Satz bildet die Oberfläche. */
sealed interface PdfFailure {
    /** Ein Abruf scheiterte; die Anzeige formuliert ihn wie jeden anderen Abruf. */
    data class Abruf(val fehler: Ergebnis.Fehler) : PdfFailure

    /** Der Server meldet den Auftrag als gescheitert, mit seinem Satz, wenn er einen schickte. */
    data class Auftrag(val satz: String?) : PdfFailure
}

/** Ausgang eines PDF-Exports: die Datei oder der Grund. */
sealed interface ExportResult {
    data class Datei(val datei: File) : ExportResult
    data class Fehler(val grund: PdfFailure) : ExportResult
}

/** Der PDF-Export als Vordergrund-Dienst, der länger lebt als der Bildschirm; im Test ein Double. */
interface PartListsExport {
    /** Wo ein laufender Export steht, null ohne Export. */
    val fortschritt: Flow<PdfProgress?>
    suspend fun erzeuge(job: Teilelistenauftrag): ExportResult
}
