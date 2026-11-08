package ch.brickinventoryapp.data.util

import okio.FileSystem
import okio.Path.Companion.toOkioPath
import okio.blackholeSink
import okio.buffer
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import javax.inject.Inject

/** Namensanfang der Anleitungen im Zwischenspeicher ([pdfAblage]); `.part` dahinter heisst: Download läuft. */
internal const val ANLEITUNG_PRAEFIX = "anleitung_"
internal const val ANLEITUNG_ENDUNG = ".bin"

/** Hier entstehen die Anzeige-Dateien grosser Anleitungen, ihr Name wird sofort gelöscht (ui/pdf/PdfQuelle.kt). */
const val ANLEITUNG_ANZEIGE_ORDNER = "anleitung_anzeige"

/**
 * Bis zu dieser Grösse entschlüsselt der Betrachter eine Anleitung in einen memfd. Darüber
 * belegte der Bereich den Arbeitsspeicher der App (bis 300 MB) und machte sie zum ersten
 * Opfer des Low-Memory-Killers; dann eine Datei, deren Name vor dem ersten Byte weg ist.
 */
const val ANLEITUNG_IM_SPEICHER_BIS: Long = 64L * 1024 * 1024

/**
 * Bauanleitungen im Zwischenspeicher, verschlüsselt wie der Bildcache: Sie nennen Setnummer
 * und Titel, also die Sammlung. Jede Datei ist an ihren Namen gebunden (SHA-256 der
 * Adresse), eine Teildatei lässt sich fortsetzen, eine gekürzte gilt nicht.
 */
class AnleitungsAblage(chiffre: AblageChiffre) {
    @Inject constructor(ablage: Ablageschluessel) : this(AblageChiffre { ablage.fuer(ZWECK) })

    private val fs = VerschluesseltesDateisystem(FileSystem.SYSTEM, chiffre, ZWECK)

    /** Klartextbytes einer Teildatei, also der Fortsetzpunkt. Eine unlesbare wird verworfen. */
    fun klartextLaenge(datei: File): Long {
        if (!datei.isFile) return 0L
        return try {
            fs.source(datei.toOkioPath()).buffer().use { it.readAll(blackholeSink()) }
        } catch (_: IOException) {
            datei.delete()
            0L
        }
    }

    /** Neu oder hinten anfügend; erst `close` schliesst mit dem Endmarker ab. */
    fun schreibe(datei: File, fortsetzen: Boolean): OutputStream {
        val pfad = datei.toOkioPath()
        return (if (fortsetzen) fs.appendingSink(pfad) else fs.sink(pfad)).buffer().outputStream()
    }

    /** Entschlüsselt beim Lesen; wirft IOException, wenn die Datei verändert oder gekürzt ist. */
    fun lies(datei: File): InputStream = fs.source(datei.toOkioPath()).buffer().inputStream()

    private companion object {
        const val ZWECK = "anleitungen"
    }
}

/** Beim Abmelden und damit beim Serverwechsel: Die Anleitungen gehören zur Sammlung des Kontos. */
fun raeumeAnleitungenAuf(cacheDir: File) {
    raeumeKlartextAnleitungenAuf(cacheDir)
    cacheDir.listFiles { f -> f.name.startsWith(ANLEITUNG_PRAEFIX) }?.forEach { it.deleteRecursively() }
}

/** Beim Start: Klartext-Anleitungen älterer Fassungen (`pdfview_*`) und Anzeige-Reste eines Absturzes. */
fun raeumeKlartextAnleitungenAuf(cacheDir: File) {
    cacheDir.listFiles { f -> f.name.startsWith("pdfview_") }?.forEach { it.delete() }
    File(cacheDir, ANLEITUNG_ANZEIGE_ORDNER).deleteRecursively()
}
