package ch.brickinventoryapp.data.util

import java.io.File

/**
 * Was mit einer zwischengespeicherten Anleitung als Nächstes zu tun ist.
 * Der Zustand hängt am Dateinamen: Ein Download schreibt in `<name>.part` und wird erst am Ende
 * umbenannt, also heisst `<name>` vorhanden = vollständig.
 */
internal sealed class PdfStep {
    /** Die Datei liegt vollstaendig vor. Nichts holen. */
    object Fertig : PdfStep()

    /**
     * Ab diesem Byte holen. `ab == 0` heisst „von vorn, ohne Range-Kopfzeile" —
     * ein `Range: bytes=0-` waere zwar gueltig, aber es fragt nach einem
     * Teilstueck und bekaeme 206 statt 200. Fuer den ersten Versuch ist die
     * schlichte Anfrage die richtige.
     */
    data class Holen(val ab: Long) : PdfStep()
}

/**
 * @param finishedSize Groesse der fertigen Datei, 0 wenn es sie nicht gibt.
 * @param partSize    Groesse der Teildatei, 0 wenn es sie nicht gibt.
 */
internal fun pdfStep(finishedSize: Long, partSize: Long): PdfStep = when {
    // Die fertige Datei schlaegt alles. Liegt daneben noch eine Teildatei,
    // ist sie ein Ueberbleibsel und wird beim naechsten Aufraeumen entsorgt.
    finishedSize > 0L -> PdfStep.Fertig
    partSize > 0L    -> PdfStep.Holen(partSize)
    else                -> PdfStep.Holen(0L)
}

/** Ordner, in dem ältere Fassungen Gutschein-PDFs ablegten; nur noch zum Aufräumen. */
const val PDF_CONFIDENTIAL_FOLDER = "pdf_vertraulich"

/**
 * Wo der Betrachter ein PDF ablegt: Anleitungen verschlüsselt im Zwischenspeicher
 * ([InstructionStore]). Ein vertrauliches PDF bekommt keine Datei (null) und bleibt im
 * Speicher ([ladePdfInDenSpeicher]). Der Name ist SHA-256 der Adresse: Bei 32 Bit
 * (hashCode) teilten sich zwei Adressen leicht eine Datei.
 */
fun pdfAblage(cacheDir: File, pdfUrl: String, vertraulich: Boolean): File? {
    if (vertraulich) return null
    val hash = java.security.MessageDigest.getInstance("SHA-256").digest(pdfUrl.toByteArray())
    return File(cacheDir, INSTRUCTION_PREFIX + hash.joinToString("") { "%02x".format(it) } + INSTRUCTION_EXTENSION)
}

/** Gutschein-PDFs älterer Fassungen löschen: beim Start und beim Abmelden. */
fun raeumeVertraulichePdfsAuf(cacheDir: File) {
    File(cacheDir, PDF_CONFIDENTIAL_FOLDER).deleteRecursively()
}

/**
 * Wohin die Teileliste kommt: Sie trägt das Inventar, also nach filesDir. Kopien
 * älterer Fassungen (extern lesbar unter Android 8/9, intern im Klartext) werden
 * dabei entfernt.
 */
internal fun partListsStore(intern: File, extern: File?): File {
    extern?.let { File(it, "pdf/teileliste.pdf").delete() }
    val folder = File(intern, "pdf").apply { mkdirs() }
    File(folder, "teileliste.pdf").delete()
    return File(folder, PART_LIST_FILE)
}

/**
 * Wie lange die Teileliste liegen bleibt: Die Meldung „fertig, antippen“ öffnet sie
 * später noch. Verschlüsselt ist sie auch dann, aber das Inventar soll nicht länger
 * auf dem Gerät liegen, als jemand es braucht.
 */
const val PART_LIST_DEADLINE_MS: Long = 30L * 60 * 1000

/** Löscht die Teileliste, wenn sie älter als [deadline] ist; beim Start und im Auftrag nach dem Export. */
fun cleanOldPartListOn(intern: File, jetzt: Long, deadline: Long = PART_LIST_DEADLINE_MS): Boolean {
    File(File(intern, "pdf"), "teileliste.pdf").delete()
    val datei = File(File(intern, "pdf"), PART_LIST_FILE)
    return datei.isFile && jetzt - datei.lastModified() >= deadline && datei.delete()
}

/**
 * Wohin das geladene APK kommt; installiert wird per PackageInstaller-Sitzung, ohne FileProvider.
 * Hier und öffentlich, weil core-update dorthin lädt und das Abmelden (unten) ihn räumt.
 */
const val UPDATE_FOLDER = "update"

/**
 * Beim Abmelden: Teileliste (Inventar) und geteilte PDFs in beiden Wurzeln, dazu ein
 * geladenes Update. Der Cache allein genügte nicht — filesDir überlebt das Abmelden,
 * und der nächste Nutzer auf dem Gerät öffnete sonst das Inventar des vorigen.
 */
fun raeumeKontoDateienAuf(intern: File, extern: File?) {
    File(intern, "pdf").deleteRecursively()
    File(intern, UPDATE_FOLDER).deleteRecursively()
    extern?.let { File(it, "pdf").deleteRecursively() }
}
