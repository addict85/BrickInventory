package ch.brickinventoryapp.update.util

/**
 * Does the loaded APK carry the announced version, and is it newer than the
 * running one? version.json can name a higher number than the APK behind the
 * address; that would install an old version (or Android would reject it as a
 * downgrade), and the app would keep offering the same update over and over.
 */
fun versionFits(inApk: Long?, gemeldet: Int, laufend: Int): Boolean =
    inApk != null && inApk == gemeldet.toLong() && inApk > laufend
