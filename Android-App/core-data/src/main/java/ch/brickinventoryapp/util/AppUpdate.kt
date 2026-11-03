package ch.brickinventoryapp.util

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.net.toUri
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest

/**
 * Die App aktualisiert sich selbst aus dem GitHub-Release: beim Start still
 * prüfen, nie von allein laden. Es geht, weil der versionCode monoton steigt
 * (VERSION_CODE_BASE + Anzahl Commits, app/build.gradle.kts).
 *
 * 1. version.json aus dem Release lesen
 * 2. versionCode vergleichen — echt grösser, nie „ungleich“
 * 3. APK nach <files>/update/ laden, Adresse gegen die Release-Ablage prüfen
 * 4. Signatur mit der installierten App vergleichen und den versionCode IM APK
 *    gegen version.json ([fassungPasst]), erst dann anbieten
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

/** Wohin das geladene APK kommt; installiert wird per PackageInstaller-Sitzung, ohne FileProvider. */
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

/** Zeigt die Adresse in unsere Release-Ablage? Geparst verglichen, siehe [liegtUnter]. */
fun istErlaubteApkAdresse(url: String): Boolean = liegtUnter(url, UPDATE_RELEASE_BASIS)

/**
 * Die Signatur eines APK als Fingerabdruck. `null`, wenn nicht lesbar oder nicht
 * signiert — dann wird nicht installiert; „unbekannt“ gilt nie als „passt“.
 */
private fun fingerabdruecke(ctx: Context, apk: File): Signatur? {
    val pm = ctx.packageManager
    val info = pm.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES) ?: return null
    // Der Paketname muss stimmen, sonst signiert ein fremdes Paket mit
    // demselben Schluessel sich hier durch.
    if (info.packageName != ctx.packageName) return null
    return signaturen(info)
}

/** Der versionCode im geladenen APK; `null`, wenn es nicht lesbar ist. */
@Suppress("DEPRECATION") // die Fassung mit PackageInfoFlags gibt es erst ab API 33
fun apkFassung(ctx: Context, apk: File): Long? =
    ctx.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
        ?.let { androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(it) }

/** Dieselbe Ermittlung fuer die INSTALLIERTE App. */
private fun eigeneFingerabdruecke(ctx: Context): Signatur? {
    val pm = ctx.packageManager
    val info = runCatching { pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES) }.getOrNull() ?: return null
    return signaturen(info)
}

/**
 * Die Signatur aus einem PackageInfo samt Ahnenreihe (v3-Rotation). `null` bei
 * fehlender Signatur: „unbekannt“ gilt nie als „passt“.
 */
private fun signaturen(info: android.content.pm.PackageInfo): Signatur? {
    fun hex(s: Array<android.content.pm.Signature>?) = s.orEmpty().map { sig ->
        MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
    }
    val si = info.signingInfo ?: return null
    val aktuell = hex(si.apkContentsSigners)
    val ahnen = if (si.hasMultipleSigners()) hex(si.apkContentsSigners) else hex(si.signingCertificateHistory)
    return Signatur(aktuell.toSet(), ahnen).takeIf { aktuell.isNotEmpty() }
}

/**
 * Stammt das APK vom Schlüssel der laufenden App oder von seinem Nachfolger
 * ([signaturFolgt])? Bei Unklarheit falsch — eine Prüfung, die im Zweifel
 * durchwinkt, ist keine.
 */
fun signaturPasst(ctx: Context, apk: File): Boolean {
    val neu = fingerabdruecke(ctx, apk) ?: return false
    val alt = eigeneFingerabdruecke(ctx) ?: return false
    return signaturFolgt(alt, neu)
}

/**
 * Darf die App Pakete installieren? Eine Erlaubnis je App; bei minSdk
 * 30 entfällt die Frage auf keinem Gerät.
 */
fun darfInstallieren(ctx: Context): Boolean =
    ctx.packageManager.canRequestPackageInstalls()

/** Fuehrt in die Systemeinstellung, in der die Erlaubnis erteilt wird. */
fun erlaubnisAbsicht(ctx: Context): Intent =
    Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
        .setData("package:${ctx.packageName}".toUri())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

/**
 * Übergibt das geprüfte APK über eine PackageInstaller-Sitzung direkt dem System.
 * Ein impliziter ACTION_VIEW ginge an jede App, die sich als Installer ausgibt;
 * hier landen die Bytes in der Sitzung, und die Antwort kommt an einen eigenen,
 * nicht exportierten Empfänger. Blockiert: im Hintergrund aufrufen.
 */
fun installiere(ctx: Context, apk: File) {
    val installer = ctx.packageManager.packageInstaller
    val parameter = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        .apply { setAppPackageName(ctx.packageName) }
    val id = installer.createSession(parameter)
    try {
        installer.openSession(id).use { sitzung ->
            apk.inputStream().use { ein ->
                sitzung.openWrite("BrickInventory", 0, apk.length()).use { aus ->
                    ein.copyTo(aus)
                    sitzung.fsync(aus)
                }
            }
            // MUTABLE ab Android 12, weil das System den Status einträgt; das Ziel ist ausdrücklich genannt.
            val antwort = PendingIntent.getBroadcast(ctx, id,
                Intent(ctx, InstallationsEmpfaenger::class.java).setPackage(ctx.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0))
            sitzung.commit(antwort.intentSender)
        }
    } catch (e: Exception) {
        runCatching { installer.abandonSession(id) }
        throw e
    }
}

/** Was die Installation meldet, wenn sie scheitert; UpdateViewModel zeigt es an. */
object Installationsmeldung {
    val fehler = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
}

/**
 * Die Antwort der Installer-Sitzung. Verlangt das System eine Bestätigung, zeigt
 * es dafür seinen eigenen Dialog (EXTRA_INTENT); dieser Empfänger ist nicht
 * exportiert, die Absicht kommt also nur vom System über unsere PendingIntent.
 */
class InstallationsEmpfaenger : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                bestaetigung(intent)?.let { ctx.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            else -> Installationsmeldung.fehler.value =
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Status $status"
        }
    }

    @Suppress("DEPRECATION")
    private fun bestaetigung(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_INTENT)
}

/** Die Datei, in die geladen wird. Immer dieselbe — ein altes APK ist Ballast. */
fun updateDatei(ctx: Context): File =
    File(File(ctx.filesDir, UPDATE_ORDNER).apply { mkdirs() }, "BrickInventory.apk")
