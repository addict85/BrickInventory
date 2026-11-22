package ch.brickinventoryapp.update

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.Signature
import android.content.pm.SigningInfo
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.update.util.signatureFits
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowSigningInfo
import java.io.File

/**
 * A loaded APK is installed only if it is the own package with the installed app's key; whatever
 * is unclear (unreadable, unsigned, a foreign package with the same key) counts as no.
 *
 * Counter-checks (run here):
 *   `fingerprints(ctx, apk) ?: return false` → `?: return true` → red “an unreadable APK …”, “an unsigned APK …”
 *   and “a foreign package …”
 *   the package name check in fingerprints() removed → red “a foreign package with the same key …”
 */
@RunWith(RobolectricTestRunner::class)
class SignatureFitsTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val pm = shadowOf(ctx.packageManager)
    private val apk = File(ctx.cacheDir, "BrickInventory.apk").apply { writeBytes(byteArrayOf(1, 2, 3)) }
    private val ownKey = byteArrayOf(10, 20, 30)

    private fun signedBy(key: ByteArray?): SigningInfo? = key?.let {
        SigningInfo::class.java.getDeclaredConstructor().newInstance().also { si ->
            Shadow.extract<ShadowSigningInfo>(si).setSignatures(arrayOf(Signature(it)))
        }
    }

    private fun archive(packageName: String, key: ByteArray?) =
        pm.setPackageArchiveInfo(apk.absolutePath, PackageInfo().apply { this.packageName = packageName; signingInfo = signedBy(key) })

    @Before fun installed() {
        pm.installPackage(PackageInfo().apply { packageName = ctx.packageName; signingInfo = signedBy(ownKey) })
    }

    @Test
    fun `the own package with the installed key fits`() {
        archive(ctx.packageName, ownKey)
        assertTrue(signatureFits(ctx, apk))
    }

    @Test
    fun `a foreign package with the same key does not fit`() {
        archive("com.example.other", ownKey)
        assertFalse(signatureFits(ctx, apk))
    }

    @Test
    fun `another key does not fit`() {
        archive(ctx.packageName, byteArrayOf(99))
        assertFalse(signatureFits(ctx, apk))
    }

    @Test
    fun `an unreadable APK does not fit`() {
        assertFalse(signatureFits(ctx, apk))
    }

    @Test
    fun `an unsigned APK does not fit`() {
        archive(ctx.packageName, null)
        assertFalse(signatureFits(ctx, apk))
    }
}
