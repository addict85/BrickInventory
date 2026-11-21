package ch.brickinventoryapp.update.util

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
import ch.brickinventoryapp.resources.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest
import ch.brickinventoryapp.data.util.UPDATE_FOLDER
import ch.brickinventoryapp.model.util.fangeAusserAbbruch

/**
 * The app updates itself from the GitHub release: check silently on start,
 * never load on its own. Works because the versionCode rises monotonically
 * (VERSION_CODE_BASE + commit count, app/build.gradle.kts).
 */

/** All of the repository's release assets; among them an immutable label per version. */
internal const val UPDATE_RELEASE_ROOT = "https://github.com/addict85/BrickInventory/releases/download"

/**
 * The assets of the release marked "Latest"; releases are immutable,
 * so a fixed location in them only via this redirect. GitHub redirects to
 * `…/download/<label>/…`; only UpdateRedirects (core-data) may follow it.
 */
const val UPDATE_RELEASE_BASE = "https://github.com/addict85/BrickInventory/releases/latest/download"

/**
 * The signed description of the newest version; written by the signing job. Whom
 * it may trust is decided solely by its signature, not by where it came from.
 */
const val UPDATE_VERSION_URL = "$UPDATE_RELEASE_BASE/version-signiert.json"

/** A version label from the workflow (android-v…); its asset is never replaced. */
private val VERSION_LABEL = Regex("android-v[0-9A-Za-z._-]{1,40}")

/**
 * Absolute upper bound for the APK: the expected size is in version.json, and
 * it is not trusted blindly — without a bound, memory would fill up before the
 * signature check gets to run. 300 MB against a roughly 46 MB APK catches a bottomless
 * stream, not a grown APK.
 */
internal const val UPDATE_MAX_BYTES: Long = 300L * 1024 * 1024

/**
 * Upper bound for version.json (five fields): it is read as a string,
 * and a tampered response must not be able to crash the app.
 */
internal const val UPDATE_JSON_MAX_BYTES: Long = 64L * 1024

/**
 * What's in version.json. `apkUrl` is still checked
 * ([isAllowedApkAddress]): following an address because it was in a loaded
 * file is the dangerous spot of any self-updater.
 */
@Serializable
data class UpdateBeschreibung(
    @SerialName("versionCode") val versionCode: Int,
    @SerialName("versionName") val versionName: String,
    @SerialName("apkUrl") val apkUrl: String,
    /**
     * The git commit the build came from — provenance, not a checksum:
     * that would come from the same file as the address. The APK's integrity is
     * secured by HTTPS and [signatureFits]. With a default value, so an older
     * version.json doesn't fail.
     */
    @SerialName("commit") val commit: String = "",
    @SerialName("apkSize") val apkSize: Long = 0,
    /**
     * SHA-256 of the APK. Only carries weight because the description is signed
     * ([checkedDescription]); in an unsigned file it would be forged along with it.
     */
    @SerialName("apkSha256") val apkSha256: String = "",
    /**
     * When it was signed and until when that holds (seconds since 1970, UTC). Without
     * them, an older, genuinely signed description could be re-uploaded
     * unnoticed ([valueFresh]); if missing, the description counts as expired.
     */
    @SerialName("ausgestellt") val ausgestellt: Long = 0,
    @SerialName("gueltigBis") val gueltigBis: Long = 0,
)

/**
 * Is the reported version newer? Strictly greater: with `!=` the app would offer a
 * downgrade after a reverted build, which Android rejects with
 * INSTALL_FAILED_VERSION_DOWNGRADE.
 */
internal fun isNew(laufend: Int, gemeldet: Int): Boolean = gemeldet > laufend

/**
 * Does the address point into our release store — the newest, or a version's
 * label? Compared parsed, see [liesBelow].
 */
fun isAllowedApkAddress(url: String): Boolean {
    if (liesBelow(url, UPDATE_RELEASE_BASE)) return true
    val etikett = url.toHttpUrlOrNull()?.pathSegments?.dropLast(1)?.lastOrNull() ?: return false
    return VERSION_LABEL.matches(etikett) && liesBelow(url, "$UPDATE_RELEASE_ROOT/$etikett")
}

/**
 * An APK's signature as a fingerprint. `null` if unreadable or not
 * signed — then it isn't installed; "unknown" never counts as "matches".
 */
private fun fingerabdruecke(ctx: Context, apk: File): Signatur? {
    val pm = ctx.packageManager
    val info = pm.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES) ?: return null
    // The package name must match, otherwise a foreign package signed with
    // the same key could slip through here.
    if (info.packageName != ctx.packageName) return null
    return signatures(info)
}

/** The versionCode in the loaded APK; `null` if it isn't readable. */
@Suppress("DEPRECATION") // the version with PackageInfoFlags only exists from API 33
fun apkVersion(ctx: Context, apk: File): Long? =
    ctx.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
        ?.let { androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(it) }

/** The same lookup for the INSTALLED app. */
private fun ownFingerprints(ctx: Context): Signatur? {
    val pm = ctx.packageManager
    val info = runCatching { pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES) }.getOrNull() ?: return null
    return signatures(info)
}

/**
 * The signature from a PackageInfo including its ancestry (v3 rotation). `null` if
 * there's no signature: "unknown" never counts as "matches".
 */
private fun signatures(info: android.content.pm.PackageInfo): Signatur? {
    fun hex(s: Array<android.content.pm.Signature>?) = s.orEmpty().map { sig ->
        MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
    }
    val si = info.signingInfo ?: return null
    val aktuell = hex(si.apkContentsSigners)
    val ancestors = if (si.hasMultipleSigners()) hex(si.apkContentsSigners) else hex(si.signingCertificateHistory)
    return Signatur(aktuell.toSet(), ancestors).takeIf { aktuell.isNotEmpty() }
}

/**
 * Does the APK come from the running app's key or its successor
 * ([signatureFollows])? False when unclear — a check that waves things
 * through when in doubt is no check at all.
 */
fun signatureFits(ctx: Context, apk: File): Boolean {
    val neu = fingerabdruecke(ctx, apk) ?: return false
    val alt = ownFingerprints(ctx) ?: return false
    return signatureFollows(alt, neu)
}

/**
 * May the app install packages? One permission per app; at minSdk
 * 30 the question doesn't come up on any device.
 */
fun installMay(ctx: Context): Boolean =
    ctx.packageManager.canRequestPackageInstalls()

/** Leads to the system setting where the permission is granted. */
fun permissionIntent(ctx: Context): Intent =
    Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
        .setData("package:${ctx.packageName}".toUri())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

/**
 * Hands the checked APK straight to the system via a PackageInstaller session.
 * An implicit ACTION_VIEW would go to any app posing as an installer;
 * here the bytes land in the session, and the response reaches our own,
 * non-exported receiver. Blocking: call in the background.
 */
fun install(ctx: Context, apk: File) {
    val installer = ctx.packageManager.packageInstaller
    val parameter = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        .apply { setAppPackageName(ctx.packageName) }
    val id = installer.createSession(parameter)
    var passed = false
    try {
        installer.openSession(id).use { sitzung ->
            apk.inputStream().use { ein ->
                sitzung.openWrite("BrickInventory", 0, apk.length()).use { aus ->
                    ein.copyTo(aus)
                    sitzung.fsync(aus)
                }
            }
            // MUTABLE from Android 12, because the system fills in the status; the target is named explicitly.
            val antwort = PendingIntent.getBroadcast(ctx, id,
                Intent(ctx, InstallationsEmpfaenger::class.java).setPackage(ctx.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0))
            sitzung.commit(antwort.intentSender)
        }
        passed = true
    } finally {
        if (!passed) fangeAusserAbbruch { installer.abandonSession(id) }
    }
}

/** What the installation reports on failure; UpdateViewModel displays it. */
object Installationsmeldung {
    val fehler = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
}

/** The confirmation dialog action of an installer session (named only as SystemApi in the SDK). */
internal const val INSTALLATION_CONFIRM = "android.content.pm.action.CONFIRM_INSTALL"

/**
 * Where the confirmation leads, if it is a system installer, else `null`.
 * The intent does come only via our own PendingIntent; passed on unchecked,
 * though, the receiver would become a springboard to any Activity,
 * Uri permissions included. Only the checked component is then launched.
 */
@Suppress("DEPRECATION") // the versions with ResolveInfoFlags only exist from API 33
internal fun installerZiel(pm: PackageManager, confirmation: Intent): ComponentName? {
    val rights = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
    if (confirmation.flags and rights != 0 || confirmation.selector != null) return null
    val ziel = pm.resolveActivity(confirmation, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo ?: return null
    val installer = pm.queryIntentActivities(Intent(INSTALLATION_CONFIRM), PackageManager.MATCH_DEFAULT_ONLY)
        .mapNotNull { it.activityInfo }
        .filter { (it.applicationInfo?.flags ?: 0) and ApplicationInfo.FLAG_SYSTEM != 0 }
        .map { it.packageName }
    return ComponentName(ziel.packageName, ziel.name).takeIf { ziel.packageName in installer }
}

/**
 * The installer session's response. If the system demands confirmation, it
 * shows its own dialog for that (EXTRA_INTENT), but only if it leads to the
 * system installer ([installerZiel]).
 */
internal class InstallationsEmpfaenger : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val dialog = confirmation(intent)
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
    private fun confirmation(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_INTENT)
}

/** The file it loads into. Always the same one — an old APK is dead weight. */
fun updateFile(ctx: Context): File =
    File(File(ctx.filesDir, UPDATE_FOLDER).apply { mkdirs() }, "BrickInventory.apk")

/** The device functions of this file, behind [UpdateDevice]. */
internal class AndroidUpdateDevice @Inject constructor(@param:ApplicationContext private val ctx: Context) : UpdateDevice {
    override fun descriptionKey(): List<ByteArray> = descriptionKey(
        ctx.resources.openRawResource(R.raw.beschreibungs_schluessel).bufferedReader().use { it.readText() })
    override fun updateFile(): File = updateFile(ctx)
    override fun signatureFits(apk: File): Boolean = signatureFits(ctx, apk)
    override fun apkVersion(apk: File): Long? = apkVersion(ctx, apk)
    override fun installMay(): Boolean = installMay(ctx)
    override fun install(apk: File) = install(ctx, apk)
}
