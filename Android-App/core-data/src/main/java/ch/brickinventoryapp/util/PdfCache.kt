package ch.brickinventoryapp.util

import java.io.File

/**
 * Was mit einer zwischengespeicherten Anleitung als Nächstes zu tun ist.
 * Ausführlich: docs/begruendungen/core-data/util/PdfCache.kt.md#pdfschritt
 */
sealed class PdfSchritt {
    /** Die Datei liegt vollstaendig vor. Nichts holen. */
    object Fertig : PdfSchritt()

    /**
     * Ab diesem Byte holen. `ab == 0` heisst „von vorn, ohne Range-Kopfzeile" —
     * ein `Range: bytes=0-` waere zwar gueltig, aber es fragt nach einem
     * Teilstueck und bekaeme 206 statt 200. Fuer den ersten Versuch ist die
     * schlichte Anfrage die richtige.
     */
    data class Holen(val ab: Long) : PdfSchritt()
}

/**
 * @param fertigeGroesse Groesse der fertigen Datei, 0 wenn es sie nicht gibt.
 * @param teilGroesse    Groesse der Teildatei, 0 wenn es sie nicht gibt.
 */
fun pdfSchritt(fertigeGroesse: Long, teilGroesse: Long): PdfSchritt = when {
    // Die fertige Datei schlaegt alles. Liegt daneben noch eine Teildatei,
    // ist sie ein Ueberbleibsel und wird beim naechsten Aufraeumen entsorgt.
    fertigeGroesse > 0L -> PdfSchritt.Fertig
    teilGroesse > 0L    -> PdfSchritt.Holen(teilGroesse)
    else                -> PdfSchritt.Holen(0L)
}

/** Ordner, in dem ältere Fassungen Gutschein-PDFs ablegten; nur noch zum Aufräumen. */
const val PDF_VERTRAULICH_ORDNER = "pdf_vertraulich"

/**
 * Wo der Betrachter ein PDF ablegt: Anleitungen verschlüsselt im Zwischenspeicher
 * ([AnleitungsAblage]). Ein vertrauliches PDF bekommt keine Datei (null) und bleibt im
 * Speicher ([ladePdfInDenSpeicher]). Der Name ist SHA-256 der Adresse: Bei 32 Bit
 * (hashCode) teilten sich zwei Adressen leicht eine Datei.
 */
fun pdfAblage(cacheDir: File, pdfUrl: String, vertraulich: Boolean): File? {
    if (vertraulich) return null
    val hash = java.security.MessageDigest.getInstance("SHA-256").digest(pdfUrl.toByteArray())
    return File(cacheDir, ANLEITUNG_PRAEFIX + hash.joinToString("") { "%02x".format(it) } + ANLEITUNG_ENDUNG)
}

/** Gutschein-PDFs älterer Fassungen löschen: beim Start und beim Abmelden. */
fun raeumeVertraulichePdfsAuf(cacheDir: File) {
    File(cacheDir, PDF_VERTRAULICH_ORDNER).deleteRecursively()
}

/**
 * Wohin die Teileliste kommt: Sie trägt das Inventar, also nach filesDir. Den
 * externen App-Bereich liest unter Android 8/9 jede App mit Speicherrecht; eine
 * Kopie älterer Fassungen dort wird entfernt. pdf/ gibt file_paths.xml frei.
 */
internal fun teilelistenAblage(intern: File, extern: File?): File {
    extern?.let { File(it, "pdf/teileliste.pdf").delete() }
    return File(File(intern, "pdf").apply { mkdirs() }, "teileliste.pdf")
}

/**
 * Wie lange die Teileliste im Klartext liegen bleibt. Sie muss es eine Weile: Die App,
 * an die sie geteilt wird, liest sie über den FileProvider, und die Meldung „fertig,
 * antippen“ öffnet sie später. Danach soll das Inventar nicht offen liegen (sec11 N1).
 */
const val TEILELISTE_FRIST_MS: Long = 30L * 60 * 1000

/** Löscht die Teileliste, wenn sie älter als [frist] ist; beim Start und im Auftrag nach dem Export. */
fun raeumeAlteTeilelisteAuf(intern: File, jetzt: Long, frist: Long = TEILELISTE_FRIST_MS): Boolean {
    val datei = File(File(intern, "pdf"), "teileliste.pdf")
    return datei.isFile && jetzt - datei.lastModified() >= frist && datei.delete()
}

/**
 * Beim Abmelden: Teileliste (Inventar) und geteilte PDFs in beiden Wurzeln, dazu ein
 * geladenes Update. Der Cache allein genügte nicht — filesDir überlebt das Abmelden,
 * und der nächste Nutzer auf dem Gerät öffnete sonst das Inventar des vorigen.
 */
fun raeumeKontoDateienAuf(intern: File, extern: File?) {
    File(intern, "pdf").deleteRecursively()
    File(intern, UPDATE_ORDNER).deleteRecursively()
    extern?.let { File(it, "pdf").deleteRecursively() }
}
