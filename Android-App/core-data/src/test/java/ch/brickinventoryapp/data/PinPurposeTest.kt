package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.fitsToPin
import ch.brickinventoryapp.security.spkiFingerprint
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64

/**
 * Under a pinned own CA only a leaf that may identify a server counts:
 * EKU serverAuth, or no EKU extension at all. The certificates
 * are fixed test data generated with openssl (root, three leaves for localhost).
 *
 * Counter-check: in fitsToPin() `|| !forServer(chain[0])` removed → red “a
 * certificate for a different purpose does not match the pin”;
 * gegenproben/pin-ohne-zweck.patch
 */
class PinPurposeTest {

    private fun zert(b64: String) = CertificateFactory.getInstance("X.509")
        .generateCertificate(Base64.getDecoder().decode(b64).inputStream()) as X509Certificate

    private val root = zert(WURZEL)
    private val pin = spkiFingerprint(root)

    @Test
    fun `a server certificate under the pinned root matches`() {
        assertTrue("EKU serverAuth", fitsToPin(arrayOf(zert(SERVER), root), pin))
        assertTrue("Ohne EKU ist jeder Zweck erlaubt", fitsToPin(arrayOf(zert(OHNE), root), pin))
    }

    @Test
    fun `a certificate for a different purpose does not match the pin`() {
        val code = zert(CODE)
        assertFalse("Code-Signatur unter der Wurzel", fitsToPin(arrayOf(code, root), pin))
        assertFalse("Auch als selbst gepinntes Blatt", fitsToPin(arrayOf(code), spkiFingerprint(code)))
    }

    private companion object {
        const val WURZEL = "MIIBlDCCATugAwIBAgIUGLAWXg+dT/uW1i/3A/CtYEgcDH8wCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMWndlY2sgV3VyemVsMCAXDTI2MTEwNDA2MTMyOVoYDzIxMjYxMDExMDYxMzI5WjAXMRUwEwYDVQQDDAxad2VjayBXdXJ6ZWwwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAT4fJk3tAjhh3ejS4gcEvHOizyN01oVscKaL7ZlDHxJibO86fd183MwjT0PAqNd5cfFt0DftqF8AsNYR3zCCKXJo2MwYTAdBgNVHQ4EFgQUzo4N5pPijyz+3J8Dvd+PQahzTPAwHwYDVR0jBBgwFoAUzo4N5pPijyz+3J8Dvd+PQahzTPAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDRwAwRAIgDnT+vxKYXXiHtWEjwZcYnZuxFbpM3uB76TD24ZaUhN4CIGtVrbJ7B5GQSDSqdX6MvvaZ/oJJlbjzqQG3OYq4h36M"
        const val SERVER = "MIIBqDCCAU2gAwIBAgIUP/0avqNOLrNwJJ2j8EsElpcnvJgwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMWndlY2sgV3VyemVsMCAXDTI2MTEwNDA2MTMyOVoYDzIxMjYxMDExMDYxMzI5WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASDL8HeZT64bazza/1RA2AKian/nfivdxTK8noPdhX9IX3Zu+GPrHwsDOG80/T8PWYp8XgyHl9LmpVax38z1SE4o3gwdjAJBgNVHRMEAjAAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBQGA1UdEQQNMAuCCWxvY2FsaG9zdDAdBgNVHQ4EFgQU1yFauzXbqwmP3U6gECKtND6dt+0wHwYDVR0jBBgwFoAUzo4N5pPijyz+3J8Dvd+PQahzTPAwCgYIKoZIzj0EAwIDSQAwRgIhAP5WaQn9ZgeZqXA2NeY+lKT4gqp8E/JG6sRYWTMQ/xASAiEA1DS1gxRcR/FfPqG4oX8VhejoA+Pkkfs/6ZThmEV3gBM="
        const val CODE = "MIIBpzCCAU2gAwIBAgIUP/0avqNOLrNwJJ2j8EsElpcnvJkwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMWndlY2sgV3VyemVsMCAXDTI2MTEwNDA2MTMyOVoYDzIxMjYxMDExMDYxMzI5WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQAPnbey07B/Cel005ORPAlkS9ni+bTE70qe4O9TGp7w3AUNjPFitCukH1f6l7fmpGhBS/QV6sxknAxRa+bSVLTo3gwdjAJBgNVHRMEAjAAMBMGA1UdJQQMMAoGCCsGAQUFBwMDMBQGA1UdEQQNMAuCCWxvY2FsaG9zdDAdBgNVHQ4EFgQUMQ96jslAwh2sOlMH/H6BRKpmEpcwHwYDVR0jBBgwFoAUzo4N5pPijyz+3J8Dvd+PQahzTPAwCgYIKoZIzj0EAwIDSAAwRQIhAMHgdlUcYlPk8u5H2dqrIEVaWqXU53Z8hqmjc0X47osQAiALwJlmSvkWY1CwlP3JpL05gtdNWyA2VQlaAQQAA8sdLg=="
        const val OHNE = "MIIBkTCCATigAwIBAgIUP/0avqNOLrNwJJ2j8EsElpcnvJowCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMWndlY2sgV3VyemVsMCAXDTI2MTEwNDA2MTMyOVoYDzIxMjYxMDExMDYxMzI5WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARxK2NbCgAsVRQnzHOXE1AWgoOQiR4qvaf2UC/pLENSXLt7ZEZWcQnPwu4Is/0ttd1iXi1AHyIgZUYcLnB8WSDMo2MwYTAJBgNVHRMEAjAAMBQGA1UdEQQNMAuCCWxvY2FsaG9zdDAdBgNVHQ4EFgQU4epoDRkU9uFZxxBkjhdnrQK6vE0wHwYDVR0jBBgwFoAUzo4N5pPijyz+3J8Dvd+PQahzTPAwCgYIKoZIzj0EAwIDRwAwRAIgLWIm8U7N0oDaH23EsOnZzwbCvxk5Fg72u20UtKEaILMCIFDsjx5+IgNdYSlBg1C9Hi7uPEkqR8sPPiW+ItIBjdvg"
    }
}
