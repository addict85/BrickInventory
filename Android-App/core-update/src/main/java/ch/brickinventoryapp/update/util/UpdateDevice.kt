package ch.brickinventoryapp.update.util

import java.io.File

/**
 * Was die Selbstaktualisierung vom Gerät braucht: Schlüssel, Ablage, Signaturprüfung und
 * Installer. Hinter einer Schnittstelle, damit das UpdateViewModel ohne
 * PackageManager ausgeführt geprüft werden kann; im Gerät AndroidUpdateDevice (AppUpdate.kt).
 */
interface UpdateDevice {
    /** SPKI der Beschreibungsschlüssel aus res/raw/beschreibungs_schluessel.pem. */
    fun descriptionKey(): List<ByteArray>
    fun updateFile(): File
    fun signatureFits(apk: File): Boolean
    fun apkVersion(apk: File): Long?
    fun installMay(): Boolean
    /** Blockiert; im Hintergrund aufrufen. */
    fun install(apk: File)
}
