package ch.brickinventoryapp.finanzen.ui.pdf

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.os.ParcelFileDescriptor
import android.system.Os
import android.system.OsConstants
import ch.brickinventoryapp.data.util.ANLEITUNG_IM_SPEICHER_BIS
import ch.brickinventoryapp.data.util.AnleitungsAblage
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.io.File
import java.io.FileDescriptor
import java.io.InputStream

/**
 * Woher der Betrachter liest. Eine Schnittstelle, damit das ViewModel ohne Gerät
 * prüfbar ist; die Seiten rendert [oeffne], Drucken und Herunterladen lesen [eingang].
 */
interface PdfQuelle : Closeable {
    fun oeffne(): ParcelFileDescriptor
    fun eingang(): InputStream
}

/** Wie weit der Betrachter ist; Fehler tragen den Text der Ursache oder einen [grund]. */
sealed class PdfLoadState {
    data class Downloading(val pct: Int, val bytes: Long, val total: Long) : PdfLoadState()
    data object Rendering : PdfLoadState()
    data class Ready(val quelle: PdfQuelle, val pageCount: Int) : PdfLoadState()
    data class Error(val message: String?, val grund: PdfFehler = PdfFehler.UNBEKANNT) : PdfLoadState()
}

/** Fehler ohne eigenen Text; den Satz wählt die Oberfläche in der Sprache der App. */
enum class PdfFehler { FREMDER_HOST, DOWNLOAD, UNBEKANNT }

/**
 * Hält die Quelle, solange der Betrachter steht. Kommt sie erst nach dem Verlassen an
 * (der Download lief noch), wird sie sofort geschlossen statt bis zum Prozessende zu leben.
 */
class PdfHalter : Closeable {
    private var quelle: PdfQuelle? = null
    private var zu = false

    @Synchronized
    fun halte(neu: PdfQuelle): Boolean {
        if (zu) {
            neu.close()
            return false
        }
        quelle?.close()
        quelle = neu
        return true
    }

    @Synchronized
    override fun close() {
        zu = true
        quelle?.close()
        quelle = null
    }
}

/**
 * Ein Bereich ohne Namen auf der Platte. PdfRenderer braucht einen Deskriptor, in dem er
 * springen kann; der Klartext soll aber nirgends liegen, wo ihn ein Dateizugriff findet.
 * Der Bereich vergeht mit [close] oder spätestens mit dem Prozess, auch nach einem Absturz.
 */
internal class PdfBereich(private val bereich: ParcelFileDescriptor, private val eingangOeffnen: () -> InputStream) : PdfQuelle {
    // Ein eigener Deskriptor je Zugriff (PdfRenderer schliesst ihn mit); alle Duplikate
    // teilen die Leseposition, also vorn beginnen wie bei einer frisch geöffneten Datei.
    override fun oeffne(): ParcelFileDescriptor =
        bereich.dup().also { Os.lseek(it.fileDescriptor, 0, OsConstants.SEEK_SET) }

    override fun eingang(): InputStream = eingangOeffnen()
    override fun close() = bereich.close()

    companion object {
        /** Ein Gutschein-PDF (Nummer und PIN): nur im memfd. */
        fun speicher(inhalt: ByteArray): PdfBereich {
            val bereich = memfd()
            fangeAusserAbbruch {
                schreibeAlles(bereich.fileDescriptor, inhalt, inhalt.size)
            }.onFailure { e ->
                bereich.close()
                throw e
            }
            return PdfBereich(bereich) { ByteArrayInputStream(inhalt) }
        }

        /** Eine Anleitung aus der verschlüsselten Ablage; grosse nicht in den Arbeitsspeicher ([ANLEITUNG_IM_SPEICHER_BIS]). */
        fun anleitung(ablage: AnleitungsAblage, datei: File, anzeige: File): PdfBereich {
            val bereich = if (datei.length() <= ANLEITUNG_IM_SPEICHER_BIS) memfd() else namenlos(anzeige)
            fangeAusserAbbruch {
                ablage.lies(datei).use { ein ->
                    val puffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = ein.read(puffer)
                        if (n < 0) break
                        schreibeAlles(bereich.fileDescriptor, puffer, n)
                    }
                }
            }.onFailure { e ->
                bereich.close()
                throw e
            }
            return PdfBereich(bereich) { ablage.lies(datei) }
        }

        private fun memfd(): ParcelFileDescriptor {
            val fd = Os.memfd_create("pdf", 0)
            try {
                return ParcelFileDescriptor.dup(fd)
            } finally {
                Os.close(fd)
            }
        }

        // Der Name ist gelöscht, bevor ein Byte Klartext hineinkommt; was bleibt, erreicht
        // nur der offene Deskriptor. Ein Absturz dazwischen hinterlässt eine leere Datei.
        private fun namenlos(ordner: File): ParcelFileDescriptor {
            ordner.mkdirs()
            val datei = File.createTempFile("anzeige", ".pdf", ordner)
            try {
                return ParcelFileDescriptor.open(datei, ParcelFileDescriptor.MODE_READ_WRITE)
            } finally {
                datei.delete()
            }
        }

        private fun schreibeAlles(fd: FileDescriptor, daten: ByteArray, laenge: Int) {
            var geschrieben = 0
            while (geschrieben < laenge) geschrieben += Os.write(fd, daten, geschrieben, laenge - geschrieben)
        }
    }
}
