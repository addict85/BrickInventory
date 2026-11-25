package ch.brickinventoryapp.update.util

import java.io.File

/**
 * What the self-update needs from the device: key, storage, signature check and
 * installer. Behind an interface, so the UpdateViewModel can be checked without
 * running the PackageManager; on the device, AndroidUpdateDevice (AppUpdate.kt).
 */
interface UpdateDevice {
    /** SPKI of the description keys from res/raw/description_key.pem. */
    fun descriptionKey(): List<ByteArray>
    fun updateFile(): File
    fun signatureFits(apk: File): Boolean
    fun apkVersion(apk: File): Long?
    fun installMay(): Boolean
    /** Blocking; call in the background. */
    fun install(apk: File)
    /** Play Store already updates the app itself; the self-update offer stays off there. */
    fun installedFromPlayStore(): Boolean
}
