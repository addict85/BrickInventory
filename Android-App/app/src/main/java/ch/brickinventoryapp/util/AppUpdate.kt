package ch.brickinventoryapp.util

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest

/**
 * Die App aktualisiert sich selbst aus dem GitHub-Release.
 *
 * ── Marcos Wunsch ───────────────────────────────────────────────────────────
 * „Wie gross waere der Aufwand dass sich die Android-App selbstaendig mit
 * Hilfe des bereitgestellten apk updatet?" — und dazu: beim Start still
 * pruefen, nie von allein laden, plus ein Knopf in den Einstellungen.
 *
 * ── Warum das ueberhaupt geht ───────────────────────────────────────────────
 * Weil der versionCode dieses Projekts monoton steigt (app/build.gradle.kts:
 * BASIS + Minuten seit 2020-01-01 UTC). Ohne eine vergleichbare Zahl waere
 * „gibt es etwas Neueres?" nicht zu beantworten, und ein Updater muesste
 * Zeitstempel vergleichen — der meldete ein Update auch dann, wenn nur der
 * Release-TEXT geaendert wurde.
 *
 * ── Der Weg, in vier Schritten ──────────────────────────────────────────────
 *  1. version.json aus dem Release lesen (der Workflow legt sie neben das APK)
 *  2. versionCode vergleichen — echt GROESSER, nie „ungleich"
 *  3. APK nach <files>/update/ laden, Adresse gegen die Release-Ablage pruefen
 *  4. Signatur mit der INSTALLIERTEN App vergleichen, dann erst anbieten
 *
 * ── Warum Schritt 4, obwohl Android es ohnehin prueft ───────────────────────
 * Android verweigert die Installation eines APK, das mit einem anderen
 * Schluessel signiert ist. Die Pruefung hier ersetzt das nicht, sie kommt
 * FRUEHER: Ohne sie stuende der Nutzer vor einer Fehlermeldung des Systems,
 * nachdem er zugestimmt hat. Mit ihr wird ein fremdes APK gar nicht erst
 * angeboten.
 */

/** Die Release-Ablage — EIN Ort, aus dem beide Adressen entstehen. */
const val UPDATE_RELEASE_BASIS =
    "https://github.com/addict85/BrickInventory/releases/download/apk-neuste"

/** Die Beschreibung der neusten Fassung; geschrieben vom Android-Workflow. */
const val UPDATE_VERSION_URL = "$UPDATE_RELEASE_BASIS/version.json"

/** Wohin das geladene APK kommt — siehe res/xml/file_paths.xml, update_internal. */
const val UPDATE_ORDNER = "update"

/**
 * Was in version.json steht.
 *
 * `apkUrl` wird MITGELIEFERT und trotzdem geprueft (siehe [istErlaubteApkAdresse]):
 * Die Datei kommt zwar ueber HTTPS aus unserem eigenen Release, aber eine
 * Adresse, der man folgt, weil sie in einer heruntergeladenen Datei stand, ist
 * genau die Stelle, an der ein Selbst-Updater gefaehrlich wird.
 */
@Serializable
data class UpdateBeschreibung(
    @SerialName("versionCode") val versionCode: Int,
    @SerialName("versionName") val versionName: String,
    @SerialName("apkUrl") val apkUrl: String,
    @SerialName("sha") val sha: String = "",
    @SerialName("apkSize") val apkSize: Long = 0,
)

/**
 * Ist die gemeldete Fassung neuer als die laufende?
 *
 * ECHT groesser, nicht „ungleich": Mit `!=` boete die App nach einem
 * zurueckgenommenen Build ein Downgrade an, das Android anschliessend mit
 * INSTALL_FAILED_VERSION_DOWNGRADE ablehnt — eine Sackgasse, aus der der
 * Nutzer nicht herausfindet.
 */
fun istNeuer(laufend: Int, gemeldet: Int): Boolean = gemeldet > laufend

/**
 * Zeigt die Adresse in unsere Release-Ablage?
 *
 * Verglichen wird der ANFANG gegen [UPDATE_RELEASE_BASIS] samt Schraegstrich —
 * ein blosses `startsWith(UPDATE_RELEASE_BASIS)` liesse
 * „…/apk-neuste.angreifer.tld/x.apk" durch. Dieselbe Falle wie beim
 * Bearer-Token, die in util/NetworkPolicy.kt schon einmal behoben wurde.
 */
fun istErlaubteApkAdresse(url: String): Boolean =
    url.startsWith("$UPDATE_RELEASE_BASIS/") && url.endsWith(".apk")

/**
 * Die Signatur eines APK, als Fingerabdruck.
 *
 * `null`, wenn die Datei nicht lesbar oder nicht signiert ist — dann wird
 * nicht installiert. Ein „unbekannt" darf hier nie als „passt schon" gelten.
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
 * Die Signaturen aus einem PackageInfo — beide Wege, weil minSdk 26 ist.
 *
 * `GET_SIGNING_CERTIFICATES` gibt es erst ab Android 9 (API 28). Auf 26 und 27
 * bleibt nur das veraltete `signatures`. Ein Updater, der auf diesen Geraeten
 * gar nichts pruefen kann, waere dort still schwaecher als anderswo — darum
 * beide Wege statt eines mit Mindestanforderung.
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
 * Stammt das geladene APK vom selben Schluessel wie die laufende App?
 *
 * Bei Unklarheit FALSCH — siehe [fingerabdruecke]. Eine Pruefung, die im
 * Zweifel durchwinkt, ist keine.
 */
fun signaturPasst(ctx: Context, apk: File): Boolean {
    val neu = fingerabdruecke(ctx, apk) ?: return false
    val alt = eigeneFingerabdruecke(ctx) ?: return false
    return neu == alt
}

/**
 * Darf die App Pakete installieren?
 *
 * Ab Android 8 ist das eine Erlaubnis JE APP, die der Nutzer in den
 * Systemeinstellungen erteilt. minSdk ist 26 — es gibt also kein Geraet, auf
 * dem diese Frage entfaellt.
 */
fun darfInstallieren(ctx: Context): Boolean =
    ctx.packageManager.canRequestPackageInstalls()

/** Fuehrt in die Systemeinstellung, in der die Erlaubnis erteilt wird. */
fun erlaubnisAbsicht(ctx: Context): Intent =
    Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
        .setData(Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

/**
 * Die Absicht, die den System-Installer oeffnet.
 *
 * Ueber den FileProvider und NICHT als `file://`-Adresse: Letztere wirft seit
 * Android 7 eine FileUriExposedException. Die Leseerlaubnis gilt nur fuer
 * diesen einen Aufruf.
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
