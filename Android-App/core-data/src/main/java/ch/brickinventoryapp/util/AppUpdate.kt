package ch.brickinventoryapp.util

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest

/**
 * Die App aktualisiert sich selbst aus dem GitHub-Release: beim Start still
 * prüfen, nie von allein laden. Es geht, weil der versionCode monoton steigt
 * (BASIS + Minuten seit 2020, app/build.gradle.kts).
 *
 * 1. version.json aus dem Release lesen
 * 2. versionCode vergleichen — echt grösser, nie „ungleich“
 * 3. APK nach <files>/update/ laden, Adresse gegen die Release-Ablage prüfen
 * 4. Signatur mit der installierten App vergleichen, erst dann anbieten
 *
 * Schritt 4 ersetzt Androids Prüfung nicht, er kommt früher: Ein fremdes APK wird
 * gar nicht erst angeboten.
 */

/** Die Release-Ablage — EIN Ort, aus dem beide Adressen entstehen. */
const val UPDATE_RELEASE_BASIS =
    "https://github.com/addict85/BrickInventory/releases/download/apk-neuste"

/** Die Beschreibung der neusten Fassung; geschrieben vom Android-Workflow. */
const val UPDATE_VERSION_URL = "$UPDATE_RELEASE_BASIS/version.json"

/**
 * Absolute Obergrenze für das APK: Die erwartete Grösse steht in version.json, und
 * der wird nicht blind vertraut — ohne Grenze liefe der Speicher voll, bevor die
 * Signaturprüfung dran ist. 300 MB bei rund 46 MB APK fangen ein Fass ohne Boden,
 * nicht ein gewachsenes APK.
 */
const val UPDATE_MAX_BYTES: Long = 300L * 1024 * 1024

/**
 * Obergrenze für version.json (fünf Felder): Sie wird als Zeichenkette gelesen,
 * und eine manipulierte Antwort soll die App nicht umbringen können.
 */
const val UPDATE_JSON_MAX_BYTES: Long = 64L * 1024

/** Wohin das geladene APK kommt — siehe res/xml/file_paths.xml, update_internal. */
const val UPDATE_ORDNER = "update"

/**
 * Was in version.json steht. `apkUrl` wird trotzdem geprüft
 * ([istErlaubteApkAdresse]): Einer Adresse zu folgen, weil sie in einer geladenen
 * Datei stand, ist die gefährliche Stelle eines Selbst-Updaters.
 */
@Serializable
data class UpdateBeschreibung(
    @SerialName("versionCode") val versionCode: Int,
    @SerialName("versionName") val versionName: String,
    @SerialName("apkUrl") val apkUrl: String,
    /**
     * Der Git-Commit, aus dem gebaut wurde — eine Herkunftsangabe, keine Prüfsumme:
     * Die käme aus derselben Datei wie die Adresse. Abgesichert wird das APK durch
     * HTTPS und [signaturPasst]. Mit Standardwert, damit eine ältere version.json
     * nicht scheitert.
     */
    @SerialName("commit") val commit: String = "",
    @SerialName("apkSize") val apkSize: Long = 0,
)

/**
 * Ist die gemeldete Fassung neuer? Echt grösser: Mit `!=` böte die App nach einem
 * zurückgenommenen Build ein Downgrade an, das Android mit
 * INSTALL_FAILED_VERSION_DOWNGRADE ablehnt.
 */
fun istNeuer(laufend: Int, gemeldet: Int): Boolean = gemeldet > laufend

/**
 * Zeigt die Adresse in unsere Release-Ablage? Verglichen wird mit Schrägstrich
 * nach der Basis — ein blosses startsWith liesse
 * „…/apk-neuste.angreifer.tld/x.apk“ durch (dieselbe Falle wie in
 * util/NetworkPolicy.kt).
 */
fun istErlaubteApkAdresse(url: String): Boolean =
    url.startsWith("$UPDATE_RELEASE_BASIS/") && url.endsWith(".apk")

/**
 * Die Signatur eines APK als Fingerabdruck. `null`, wenn nicht lesbar oder nicht
 * signiert — dann wird nicht installiert; „unbekannt“ gilt nie als „passt“.
 */
private fun fingerabdruecke(ctx: Context, apk: File): Set<String>? {
    val pm = ctx.packageManager
    @Suppress("DEPRECATION")
    val flagge = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
        PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val info = pm.getPackageArchiveInfo(apk.absolutePath, flagge) ?: return null
    // Der Paketname muss stimmen, sonst signiert ein fremdes Paket mit
    // demselben Schluessel sich hier durch.
    if (info.packageName != ctx.packageName) return null
    return signaturen(info)?.takeIf { it.isNotEmpty() }
}

/** Dieselbe Ermittlung fuer die INSTALLIERTE App. */
private fun eigeneFingerabdruecke(ctx: Context): Set<String>? {
    val pm = ctx.packageManager
    @Suppress("DEPRECATION")
    val flagge = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
        PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val info = runCatching { pm.getPackageInfo(ctx.packageName, flagge) }.getOrNull() ?: return null
    return signaturen(info)?.takeIf { it.isNotEmpty() }
}

/**
 * Die Signaturen aus einem PackageInfo, beide Wege: GET_SIGNING_CERTIFICATES gibt
 * es erst ab API 28, auf 26 und 27 bleibt `signatures`. Sonst prüfte der Updater
 * dort nichts.
 */
@Suppress("DEPRECATION")
private fun signaturen(info: android.content.pm.PackageInfo): Set<String>? {
    val roh: Array<android.content.pm.Signature>? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val si = info.signingInfo ?: return null
            if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory
        } else {
            info.signatures
        }
    return roh?.map { sig ->
        MessageDigest.getInstance("SHA-256").digest(sig.toByteArray())
            .joinToString("") { "%02x".format(it) }
    }?.toSet()
}

/**
 * Stammt das APK vom selben Schlüssel wie die laufende App? Bei Unklarheit falsch
 * — eine Prüfung, die im Zweifel durchwinkt, ist keine.
 */
fun signaturPasst(ctx: Context, apk: File): Boolean {
    val neu = fingerabdruecke(ctx, apk) ?: return false
    val alt = eigeneFingerabdruecke(ctx) ?: return false
    return neu == alt
}

/**
 * Darf die App Pakete installieren? Ab Android 8 eine Erlaubnis je App; bei minSdk
 * 26 entfällt die Frage auf keinem Gerät.
 */
fun darfInstallieren(ctx: Context): Boolean =
    ctx.packageManager.canRequestPackageInstalls()

/** Fuehrt in die Systemeinstellung, in der die Erlaubnis erteilt wird. */
fun erlaubnisAbsicht(ctx: Context): Intent =
    Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
        .setData("package:${ctx.packageName}".toUri())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

/**
 * Die Absicht, die den System-Installer öffnet — über den FileProvider, weil
 * `file://` seit Android 7 eine FileUriExposedException wirft; die Leseerlaubnis
 * gilt nur für diesen Aufruf.
 */
fun installationsAbsicht(ctx: Context, apk: File): Intent {
    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.provider", apk)
    return Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/** Die Datei, in die geladen wird. Immer dieselbe — ein altes APK ist Ballast. */
fun updateDatei(ctx: Context): File =
    File(File(ctx.filesDir, UPDATE_ORDNER).apply { mkdirs() }, "BrickInventory.apk")
