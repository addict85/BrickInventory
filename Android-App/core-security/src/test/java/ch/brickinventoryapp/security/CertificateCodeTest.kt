package ch.brickinventoryapp.security

import ch.brickinventoryapp.security.CertificateQuestion.CodeCheck
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

/**
 * The certificate code from the web app (`brickinventory-cert:v1:spki-sha256:<hex>`): parsed
 * strictly, compared over all 32 bytes.
 *
 * Counter-checks (counter-checks/, job `counter-checks`):
 *   (a) check() compares only the last 12 bytes → red “a code that differs only in the front
 *       does not fit” (certificate-code-only-end.patch)
 *   (b) parse() without the version check → red “a different version is refused as unknown”
 *       (certificate-code-any-version.patch)
 *   (c) parse() accepts fewer than 64 hex digits → red “a shortened code is not a code”
 *       (certificate-code-short.patch)
 */
class CertificateCodeTest {

    private val bytes = ByteArray(32) { (it * 7 + 3).toByte() }
    private val fp = Base64.getEncoder().encodeToString(bytes)
    private val hex = bytes.joinToString("") { "%02x".format(it) }
    private val code = "brickinventory-cert:v1:spki-sha256:$hex"

    @Test
    fun `the code of the presented key fits`() {
        assertArrayEquals(bytes, CertificateCode.parse(code))
        assertEquals(CodeCheck.MATCHES, CertificateCode.check(code, fp))
    }

    @Test
    fun `upper case, colons and spaces between the pairs change nothing`() {
        val colons = bytes.joinToString(":") { "%02X".format(it) }
        assertEquals(CodeCheck.MATCHES, CertificateCode.check("brickinventory-cert:v1:spki-sha256:$colons", fp))
        assertEquals(CodeCheck.MATCHES, CertificateCode.check(code.uppercase(), fp))
        val spaced = bytes.joinToString(" ") { "%02x".format(it) }
        assertEquals(CodeCheck.MATCHES, CertificateCode.check("  brickinventory-cert:v1:spki-sha256:$spaced\n", fp))
    }

    @Test
    fun `a code that differs only in the front does not fit`() {
        val front = bytes.copyOf().also { it[0] = (it[0] + 1).toByte() }
        val other = "brickinventory-cert:v1:spki-sha256:" + front.joinToString("") { "%02x".format(it) }
        assertEquals(CodeCheck.FITS_NOT, CertificateCode.check(other, fp))
        val back = bytes.copyOf().also { it[31] = (it[31] + 1).toByte() }
        assertEquals(CodeCheck.FITS_NOT,
            CertificateCode.check("brickinventory-cert:v1:spki-sha256:" + back.joinToString("") { "%02x".format(it) }, fp))
    }

    @Test
    fun `a different prefix is not a code`() {
        assertEquals(CodeCheck.NOT_A_CODE, CertificateCode.check("brickinventory:v1:spki-sha256:$hex", fp))
        assertEquals(CodeCheck.NOT_A_CODE, CertificateCode.check(hex, fp))
        assertEquals("the sign-in code is not a certificate code", CodeCheck.NOT_A_CODE,
            CertificateCode.check("""{"url":"https://nas:8443","token":"bim:abc","fp":"$fp"}""", fp))
        assertEquals(CodeCheck.NOT_A_CODE, CertificateCode.check(null, fp))
    }

    @Test
    fun `a different version is refused as unknown`() {
        assertEquals(CodeCheck.UNKNOWN_VERSION, CertificateCode.check("brickinventory-cert:v2:spki-sha256:$hex", fp))
        assertEquals(CodeCheck.UNKNOWN_VERSION, CertificateCode.check("brickinventory-cert:v1:sha512:$hex", fp))
        assertEquals(CodeCheck.UNKNOWN_VERSION, CertificateCode.check("brickinventory-cert:v2", fp))
        assertNull(CertificateCode.parse("brickinventory-cert:v2:spki-sha256:$hex"))
    }

    @Test
    fun `a shortened code is not a code`() {
        val end = "brickinventory-cert:v1:spki-sha256:" + hex.takeLast(24)
        assertNull(CertificateCode.parse(end))
        assertEquals("the end alone would be the guessable short code", CodeCheck.NOT_A_CODE, CertificateCode.check(end, fp))
        assertEquals(CodeCheck.NOT_A_CODE, CertificateCode.check(code + "00", fp))
        assertEquals(CodeCheck.NOT_A_CODE, CertificateCode.check(code.dropLast(1) + "g", fp))
    }
}
