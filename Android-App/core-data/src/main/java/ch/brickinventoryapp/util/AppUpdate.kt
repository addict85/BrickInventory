package ch.brickinventoryapp.util

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.net.toUri
import ch.brickinventoryapp.ressourcen.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest

/**
 * Die App aktualisiert sich selbst aus dem GitHub-Release: beim Start still
 * prüfen, nie von allein laden. Es geht, weil der versionCode monoton steigt
 * (VERSION_CODE_BASE + Anzahl Commits, app/build.gradle.kts).
 * Ausführlich: docs/begruendungen/core-data/util/AppUpdate.kt.md#z20
 */

/** Alle Release-Anhänge des Repositorys; darunter je Fassung ein unveränderliches Etikett. */
internal const val UPDATE_RELEASE_WURZEL = "https://github.com/addict85/BrickInventory/releases/download"

/** Die Release-Ablage der neusten Fassung — EIN Ort, aus dem die Adressen entstehen. */
const val UPDATE_RELEASE_BASIS = "$UPDATE_RELEASE_WURZEL/apk-neuste"

/**
 * Die signierte Beschreibung der neusten Fassung; geschrieben vom Signierjob. Die
 * unsignierte version.json daneben liest diese App nie; sie bleibt bis zu einem
 * Stichtag nur für ältere installierte Fassungen (android.yml, Job `release`).
 */
const val UPDATE_VERSION_URL = "$UPDATE_RELEASE_BASIS/version-signiert.json"

/** Ein Fassungsetikett des Workflows (android-v…); sein Anhang wird nie ersetzt. */
private val FASSUNGS_ETIKETT = Regex("android-v[0-9A-Za-z._-]{1,40}")

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
internal const val UPDATE_ORDNER = "update"

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
    /**
     * SHA-256 des APK. Trägt nur, weil die Beschreibung signiert ist
     * ([gepruefteBeschreibung]); in einer unsignierten Datei fälschte man sie mit.
     */
    @SerialName("apkSha256") val apkSha256: String = "",
    /**
     * Wann signiert wurde und bis wann das gilt (Sekunden seit 1970, UTC). Ohne sie
     * liesse sich eine ältere, echt signierte Beschreibung unbemerkt wieder
     * hochladen ([bewerteFrische]); fehlen sie, gilt die Beschreibung als abgelaufen.
     */
    @SerialName("ausgestellt") val ausgestellt: Long = 0,
    @SerialName("gueltigBis") val gueltigBis: Long = 0,
)

/**
 * Ist die gemeldete Fassung neuer? Echt grösser: Mit `!=` böte die App nach einem
 * zurückgenommenen Build ein Downgrade an, das Android mit
 * INSTALL_FAILED_VERSION_DOWNGRADE ablehnt.
 */
fun istNeuer(laufend: Int, gemeldet: Int): Boolean = gemeldet > laufend

/**
 * Zeigt die Adresse in unsere Release-Ablage — die neuste oder das Etikett einer
 * Fassung? Geparst verglichen, siehe [liegtUnter].
 */
fun istErlaubteApkAdresse(url: String): Boolean {
    if (liegtUnter(url, UPDATE_RELEASE_BASIS)) return true
    val etikett = url.toHttpUrlOrNull()?.pathSegments?.dropLast(1)?.lastOrNull() ?: return false
    return FASSUNGS_ETIKETT.matches(etikett) && liegtUnter(url, "$UPDATE_RELEASE_WURZEL/$etikett")
}

/** Die Signierzertifikate der installierten App (DER); gegen sie wird die Beschreibung geprüft. */
fun eigeneZertifikate(ctx: Context): List<ByteArray> {
    val info = runCatching {
        ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    }.getOrNull() ?: return emptyList()
    return info.signingInfo?.apkContentsSigners.orEmpty().map { it.toByteArray() }
}

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
    var uebergeben = false
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
        uebergeben = true
    } finally {
        if (!uebergeben) fangeAusserAbbruch { installer.abandonSession(id) }
    }
}

/** Was die Installation meldet, wenn sie scheitert; UpdateViewModel zeigt es an. */
object Installationsmeldung {
    val fehler = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
}

/** Die Aktion des Bestätigungsdialogs einer Installer-Sitzung (im SDK nur als SystemApi benannt). */
internal const val INSTALLATION_BESTAETIGEN = "android.content.pm.action.CONFIRM_INSTALL"

/**
 * Wohin die Bestätigung führt, wenn das ein System-Installer ist, sonst `null`.
 * Die Absicht kommt zwar nur über unsere PendingIntent; ungeprüft weitergereicht
 * würde der Empfänger aber zum Sprungbrett zu einer beliebigen Activity samt
 * Uri-Rechten. Gestartet wird danach genau die geprüfte Komponente.
 */
@Suppress("DEPRECATION") // die Fassungen mit ResolveInfoFlags gibt es erst ab API 33
fun installerZiel(pm: PackageManager, bestaetigung: Intent): ComponentName? {
    val rechte = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
    if (bestaetigung.flags and rechte != 0 || bestaetigung.selector != null) return null
    val ziel = pm.resolveActivity(bestaetigung, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo ?: return null
    val installer = pm.queryIntentActivities(Intent(INSTALLATION_BESTAETIGEN), PackageManager.MATCH_DEFAULT_ONLY)
        .mapNotNull { it.activityInfo }
        .filter { (it.applicationInfo?.flags ?: 0) and ApplicationInfo.FLAG_SYSTEM != 0 }
        .map { it.packageName }
    return ComponentName(ziel.packageName, ziel.name).takeIf { ziel.packageName in installer }
}

/**
 * Die Antwort der Installer-Sitzung. Verlangt das System eine Bestätigung, zeigt
 * es dafür seinen eigenen Dialog (EXTRA_INTENT), aber nur, wenn er zum
 * System-Installer führt ([installerZiel]).
 */
class InstallationsEmpfaenger : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val dialog = bestaetigung(intent)
                val ziel = dialog?.let { installerZiel(ctx.packageManager, it) }
                if (dialog != null && ziel != null) {
                    ctx.startActivity(Intent(dialog).setComponent(ziel).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } else {
                    Installationsmeldung.fehler.value = ctx.getString(R.string.update_installer_fremd)
                }
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

/** Die Gerätefunktionen dieser Datei hinter [UpdateGeraet]. */
class AndroidUpdateGeraet @Inject constructor(@param:ApplicationContext private val ctx: Context) : UpdateGeraet {
    override fun beschreibungsSchluessel(): List<ByteArray> = beschreibungsSchluessel(
        ctx.resources.openRawResource(R.raw.beschreibungs_schluessel).bufferedReader().use { it.readText() })
    override fun eigeneZertifikate(): List<ByteArray> = eigeneZertifikate(ctx)
    override fun updateDatei(): File = updateDatei(ctx)
    override fun signaturPasst(apk: File): Boolean = signaturPasst(ctx, apk)
    override fun apkFassung(apk: File): Long? = apkFassung(ctx, apk)
    override fun darfInstallieren(): Boolean = darfInstallieren(ctx)
    override fun installiere(apk: File) = installiere(ctx, apk)
}
