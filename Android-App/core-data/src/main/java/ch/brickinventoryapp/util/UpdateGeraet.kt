package ch.brickinventoryapp.util

import java.io.File

/**
 * Was die Selbstaktualisierung vom Gerät braucht: Schlüssel, Signierer, Ablage und
 * Installer. Hinter einer Schnittstelle, damit das UpdateViewModel ohne
 * PackageManager ausgeführt geprüft werden kann; im Gerät AndroidUpdateGeraet (AppUpdate.kt).
 */
interface UpdateGeraet {
    /** SPKI der Beschreibungsschlüssel aus res/raw/beschreibungs_schluessel.pem. */
    fun beschreibungsSchluessel(): List<ByteArray>
    fun eigeneZertifikate(): List<ByteArray>
    fun updateDatei(): File
    fun signaturPasst(apk: File): Boolean
    fun apkFassung(apk: File): Long?
    fun darfInstallieren(): Boolean
    /** Blockiert; im Hintergrund aufrufen. */
    fun installiere(apk: File)
}
